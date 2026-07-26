// @ts-nocheck
import { AgentClient } from './AgentClient';
import axios from 'axios';
import * as storeContainer from '../store/container';
import logger from '../log';
import * as event from '../event';

jest.mock('axios');
jest.mock('https');
jest.mock('fs');
jest.mock('../log', () => ({
    child: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));
jest.mock('../store/container');
jest.mock('../event');

describe('AgentClient', () => {
    let client;
    let mockLog;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLog = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            debug: jest.fn(),
            child: jest.fn().mockReturnThis(),
        };
        // @ts-ignore
        logger.child.mockReturnValue(mockLog);

        // Mock store insert/update
        storeContainer.insertContainer.mockImplementation((c) => c);
        storeContainer.updateContainer.mockImplementation((c) => c);
        storeContainer.getContainer.mockReturnValue(undefined);
        storeContainer.getContainers.mockReturnValue([]);

        client = new AgentClient('test-agent', {
            host: 'localhost',
            port: 3000,
            secret: 'secret',
        });
    });

    test('should prune old containers after handshake', async () => {
        const newContainers = [{ id: '1', name: 'new' }];
        const oldContainer = { id: '2', name: 'old', agent: 'test-agent' };

        // Mock store having old container
        storeContainer.getContainers.mockReturnValue([oldContainer]);
        storeContainer.deleteContainer.mockImplementation(() => {});

        // Handshake response
        // @ts-ignore
        axios.get.mockResolvedValue({ data: newContainers });
        // @ts-ignore
        axios.mockResolvedValue({ data: { on: jest.fn() } }); // Mock stream

        await client.handshake();

        expect(storeContainer.getContainers).toHaveBeenCalledWith({
            agent: 'test-agent',
        });
        expect(storeContainer.deleteContainer).toHaveBeenCalledWith('2');
    });

    test('should prune old containers after watch', async () => {
        const newContainers = [{ id: '1', name: 'new' }];
        const oldContainer = {
            id: '2',
            name: 'old',
            agent: 'test-agent',
            watcher: 'remote',
        };

        // Mock store having old container
        storeContainer.getContainers.mockReturnValue([oldContainer]);
        storeContainer.deleteContainer.mockImplementation(() => {});

        // @ts-ignore
        axios.post.mockResolvedValue({
            data: [{ container: newContainers[0], changed: false }],
        });

        await client.watch('docker', 'remote');

        expect(storeContainer.getContainers).toHaveBeenCalledWith({
            agent: 'test-agent',
            watcher: 'remote',
        });
        expect(storeContainer.deleteContainer).toHaveBeenCalledWith('2');
    });

    test('should init and handshake on wud:ack', async () => {
        const containers = [{ id: '1', name: 'c1' }];
        // Handshake response
        // @ts-ignore
        axios.get.mockResolvedValue({ data: containers });

        // SSE Stream Mock
        const mockStream = {
            on: jest.fn(),
        };
        // @ts-ignore
        axios.mockResolvedValue({ data: mockStream });

        await client.init();

        // Expect SSE connection to be started
        expect(axios).toHaveBeenCalledWith(
            expect.objectContaining({
                url: expect.stringContaining('/api/events'),
            }),
        );

        // Simulate wud:ack event
        // Find the data handler
        const dataHandler = mockStream.on.mock.calls.find(
            (call) => call[0] === 'data',
        )[1];
        expect(dataHandler).toBeDefined();

        // Simulate event
        dataHandler('data: {"type":"wud:ack","data":{"version":"1.0.0"}}\n\n');

        // Allow async loop to process
        await new Promise(process.nextTick);

        // Expect Handshake
        expect(axios.get).toHaveBeenCalledWith(
            expect.stringContaining('/api/containers'),
            expect.anything(),
        );
        expect(storeContainer.insertContainer).toHaveBeenCalled();
        expect(event.emitContainerReport).toHaveBeenCalled();
    });

    test('should reconnect on SSE stream error', async () => {
        jest.useFakeTimers();
        const mockStream = {
            on: jest.fn(),
        };
        // @ts-ignore
        axios.mockResolvedValue({ data: mockStream });

        await client.init();

        // 1. Initial connection
        expect(axios).toHaveBeenCalledTimes(1);

        // Find error handler
        const errorHandler = mockStream.on.mock.calls.find(
            (call) => call[0] === 'error',
        )[1];
        expect(errorHandler).toBeDefined();

        // 2. Emit error
        errorHandler(new Error('Stream broken'));

        // Expect log
        expect(mockLog.error).toHaveBeenCalledWith(
            expect.stringContaining('SSE Connection failed'),
        );

        // 3. Fast forward time
        jest.advanceTimersByTime(1000);

        // 4. Expect reconnection
        expect(axios).toHaveBeenCalledTimes(2);

        jest.useRealTimers();
    });

    test('processContainer should set agent name and emit report', async () => {
        const container = {
            id: '1',
            name: 'mongo',
        };

        // @ts-ignore
        await client.processContainer(container);

        expect(container.agent).toBe('test-agent');
        expect(storeContainer.insertContainer).toHaveBeenCalledWith(container);
        expect(event.emitContainerReport).toHaveBeenCalledWith(
            expect.objectContaining({
                container: expect.objectContaining({
                    id: '1',
                    agent: 'test-agent',
                }),
                changed: true,
            }),
        );
    });

    test('processContainer should detect changes', async () => {
        const container = {
            id: '1',
            name: 'mongo',
            updateAvailable: true,
        };

        const existingContainer = {
            ...container,
            resultChanged: jest.fn().mockReturnValue(true),
        };

        storeContainer.getContainer.mockReturnValue(existingContainer);
        storeContainer.updateContainer.mockReturnValue(existingContainer);

        // @ts-ignore
        await client.processContainer(container);

        expect(storeContainer.updateContainer).toHaveBeenCalledWith(container);
        expect(event.emitContainerReport).toHaveBeenCalledWith(
            expect.objectContaining({
                changed: true,
            }),
        );
    });

    test('watch() should post to /api/watchers/... and process containers', async () => {
        const containers = [{ id: 'c1' }];
        // @ts-ignore
        axios.post.mockResolvedValue({
            data: [{ container: containers[0], changed: false }],
        });

        const spyProcess = jest.spyOn(client, 'processContainer');

        const result = await client.watch('docker', 'remote');

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/watchers/docker/remote'),
            {},
            expect.anything(),
        );
        expect(spyProcess).toHaveBeenCalledWith(containers[0]);
        expect(result).toHaveLength(1);
        expect(result[0].container).toEqual(containers[0]);
    });

    test('watchContainer() should post to /api/watchers/.../container/... and process result', async () => {
        const container = { id: 'c1', name: 'c1' };
        // @ts-ignore
        axios.post.mockResolvedValue({
            data: { container: container, changed: false },
        });

        const result = await client.watchContainer(
            'docker',
            'remote',
            container,
        );

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/watchers/docker/remote/container/c1'),
            {},
            expect.anything(),
        );
        expect(storeContainer.insertContainer).toHaveBeenCalled();
        expect(result.container).toEqual(container);
    });

    test('runRemoteTriggerBatch should post to /api/triggers/.../batch', async () => {
        // @ts-ignore
        axios.post.mockResolvedValue({});
        const containers = [{ id: '1' }, { id: '2' }];

        await client.runRemoteTriggerBatch(containers, 'docker', 'restart');

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/triggers/docker/restart/batch'),
            containers,
            expect.anything(),
        );
    });

    test('deleteContainer should delete to /api/containers/...', async () => {
        // @ts-ignore
        axios.delete.mockResolvedValue({});

        await client.deleteContainer('123');

        expect(axios.delete).toHaveBeenCalledWith(
            expect.stringContaining('/api/containers/123'),
            expect.anything(),
        );
    });
});
