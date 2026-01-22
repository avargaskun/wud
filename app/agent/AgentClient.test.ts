// @ts-nocheck
import { AgentClient } from './AgentClient';
import axios from 'axios';
import * as storeContainer from '../store/container';
import * as utils from '../watchers/providers/docker/utils';
import logger from '../log';

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
jest.mock('../watchers/providers/docker/utils');

describe('AgentClient', () => {
    let client;
    let mockLog;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLog = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            child: jest.fn().mockReturnThis(),
        };
        // @ts-ignore
        logger.child.mockReturnValue(mockLog);

        client = new AgentClient('test-agent', {
            host: 'localhost',
            port: 3000,
            secret: 'secret',
        });
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

        // @ts-ignore
        utils.findNewVersion.mockResolvedValue({ tag: '2.0.0' });
        // @ts-ignore
        utils.normalizeContainer.mockImplementation((c) => c);

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
        expect(utils.normalizeContainer).toHaveBeenCalledWith(containers[0]);
        expect(storeContainer.insertContainer).toHaveBeenCalled();
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

    test('should reset unknown registry url before normalization', async () => {
        const container = {
            id: '1',
            name: 'mongo',
            image: {
                registry: { name: 'unknown', url: 'unknown' },
            },
        };

        // @ts-ignore
        utils.normalizeContainer.mockImplementation((c) => c);
        // @ts-ignore
        utils.findNewVersion.mockResolvedValue({});

        // @ts-ignore
        await client.processContainer(container);

        expect(utils.normalizeContainer).toHaveBeenCalledWith(
            expect.objectContaining({
                image: expect.objectContaining({
                    registry: expect.objectContaining({
                        url: '',
                    }),
                }),
            }),
        );
    });

    test('watch() should post to /api/watchers/... and process containers', async () => {
        const containers = [{ id: 'c1' }];
        // @ts-ignore
        axios.post.mockResolvedValue({ data: containers });
        // @ts-ignore
        utils.normalizeContainer.mockImplementation((c) => c);
        // @ts-ignore
        utils.findNewVersion.mockResolvedValue({});

        const result = await client.watch('docker', 'remote');

        expect(axios.post).toHaveBeenCalledWith(
            expect.stringContaining('/api/watchers/docker/remote'),
            {},
            expect.anything(),
        );
        expect(utils.normalizeContainer).toHaveBeenCalledWith(containers[0]);
        expect(result).toHaveLength(1);
        expect(result[0].container).toEqual(containers[0]);
    });

    test('watchContainer() should post to /api/watchers/.../container/... and process result', async () => {
        const container = { id: 'c1', name: 'c1' };
        // @ts-ignore
        axios.post.mockResolvedValue({ data: container });
        // @ts-ignore
        utils.normalizeContainer.mockImplementation((c) => c);
        // @ts-ignore
        utils.findNewVersion.mockResolvedValue({});

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
        expect(utils.normalizeContainer).toHaveBeenCalledWith(container);
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
});
