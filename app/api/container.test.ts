import { Request, Response } from 'express';
import { getContainerTriggers, runTriggerBatch } from './container.handlers';
import * as storeContainer from '../store/container';
import * as registry from '../registry';

jest.mock('../store/container');
jest.mock('../registry');
jest.mock('./component');
jest.mock('../triggers/providers/Trigger');
jest.mock('../log', () => ({
    child: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

describe('Container API', () => {
    const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        sendStatus: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (registry.getState as jest.Mock).mockReturnValue({ trigger: {} });
    });

    describe('getContainerTriggers', () => {
        const mockTrigger1 = {
            getId: () => 'docker.t1',
            type: 'docker',
            name: 't1',
            configuration: { threshold: 'all' },
            apply: jest.fn(),
            maskConfiguration: jest.fn(),
            isAutoForContainer: jest.fn().mockReturnValue(true),
        };
        const mockTrigger2 = {
            getId: () => 'slack.t2',
            type: 'slack',
            name: 't2',
            configuration: {},
            apply: jest.fn(),
            maskConfiguration: jest.fn(),
            isAutoForContainer: jest.fn().mockReturnValue(true),
        };

        beforeEach(() => {
            (registry.getState as jest.Mock).mockReturnValue({
                trigger: {
                    'docker.t1': mockTrigger1,
                    'slack.t2': mockTrigger2,
                },
            });
            mockTrigger1.apply.mockReset();
            mockTrigger2.apply.mockReset();
            mockTrigger1.maskConfiguration.mockReset();
            mockTrigger2.maskConfiguration.mockReset();
        });

        test('should return 404 if container is not found', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                undefined,
            );
            const req = { params: { id: 'unknown' } };

            await getContainerTriggers(req, mockRes);

            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return triggers that are applicable', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            mockTrigger1.apply.mockReturnValue(mockTrigger1.configuration);
            mockTrigger1.maskConfiguration.mockReturnValue(
                mockTrigger1.configuration,
            );

            mockTrigger2.apply.mockReturnValue(undefined); // Not applicable

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockTrigger1.apply).toHaveBeenCalledWith(container);
            expect(mockTrigger2.apply).toHaveBeenCalledWith(container);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 't1' }),
            ]);
            // check t2 not present
            const response = mockRes.json.mock.calls[0][0];
            expect(response).toHaveLength(1);
            expect(response[0].name).toBe('t1');
        });

        test('should return triggers sorted by type and name', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            // t1 is docker, t2 is slack. docker < slack.
            mockTrigger1.apply.mockReturnValue(mockTrigger1.configuration);
            mockTrigger1.maskConfiguration.mockReturnValue(
                mockTrigger1.configuration,
            );
            mockTrigger2.apply.mockReturnValue(mockTrigger2.configuration);
            mockTrigger2.maskConfiguration.mockReturnValue(
                mockTrigger2.configuration,
            );

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ type: 'docker', name: 't1' }),
                expect.objectContaining({ type: 'slack', name: 't2' }),
            ]);
        });

        test('should include auto: true when isAutoForContainer returns true', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            mockTrigger1.apply.mockReturnValue(mockTrigger1.configuration);
            mockTrigger1.maskConfiguration.mockReturnValue(
                mockTrigger1.configuration,
            );
            mockTrigger1.isAutoForContainer.mockReturnValue(true);

            mockTrigger2.apply.mockReturnValue(undefined);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            const response = mockRes.json.mock.calls[0][0];
            expect(response).toHaveLength(1);
            expect(response[0]).toEqual(
                expect.objectContaining({ name: 't1', auto: true }),
            );
        });

        test('should include auto: false when isAutoForContainer returns false (per-container override)', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            mockTrigger1.apply.mockReturnValue(mockTrigger1.configuration);
            mockTrigger1.maskConfiguration.mockReturnValue(
                mockTrigger1.configuration,
            );
            mockTrigger1.isAutoForContainer.mockReturnValue(false);

            mockTrigger2.apply.mockReturnValue(undefined);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            const response = mockRes.json.mock.calls[0][0];
            expect(response).toHaveLength(1);
            expect(response[0]).toEqual(
                expect.objectContaining({ name: 't1', auto: false }),
            );
        });
    });

    describe('runTriggerBatch', () => {
        const mockTriggerBatch = jest.fn();
        const mockGetUnbatchable = jest.fn();

        const buildContainer = (overrides = {}) => ({
            id: 'c1',
            name: 'c1',
            watcher: 'local',
            updateAvailable: true,
            updateKind: { kind: 'tag' },
            ...overrides,
        });

        const callHandler = (params: Record<string, string>, body: unknown) =>
            runTriggerBatch(
                { params, body } as unknown as Request,
                mockRes as unknown as Response,
            );

        beforeEach(() => {
            mockTriggerBatch.mockReset().mockResolvedValue(undefined);
            mockGetUnbatchable.mockReset().mockResolvedValue([]);
            (registry.getState as jest.Mock).mockReturnValue({
                trigger: {
                    'docker.update': {
                        triggerBatch: mockTriggerBatch,
                        getUnbatchableContainers: mockGetUnbatchable,
                    },
                },
            });
        });

        test('should return 400 when containerIds is missing', async () => {
            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                {},
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 when containerIds is empty', async () => {
            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: [] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('should return 400 when containerIds is not an array', async () => {
            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: 'c1' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
        });

        test('should return 404 when the trigger is not found', async () => {
            (registry.getState as jest.Mock).mockReturnValue({ trigger: {} });

            await callHandler(
                { triggerType: 'docker', triggerName: 'nope' },
                { containerIds: ['c1'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Trigger not found',
            });
        });

        test('should return 404 with missing ids and not call triggerBatch when a container is unknown', async () => {
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) =>
                    id === 'c1' ? buildContainer({ id: 'c1' }) : undefined,
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'missing1'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Container(s) not found',
                missing: ['missing1'],
            });
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 for a mixed-agent batch', async () => {
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) =>
                    buildContainer({
                        id,
                        agent: id === 'c2' ? 'remote' : undefined,
                    }),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ containers: ['c2'] }),
            );
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 for a mixed-watcher batch', async () => {
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) =>
                    buildContainer({
                        id,
                        watcher: id === 'c2' ? 'local2' : 'local',
                    }),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'All containers must share the same watcher',
            });
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 when containerIds contains duplicates', async () => {
            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c1'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ duplicates: ['c1'] }),
            );
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 when a container has no pending update', async () => {
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => buildContainer({ id, updateAvailable: id !== 'c2' }),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ containers: ['c2'] }),
            );
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 when a container has updateAvailable but no updateKind', async () => {
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) =>
                    buildContainer({
                        id,
                        updateAvailable: true,
                        updateKind: id === 'c2' ? undefined : { kind: 'tag' },
                    }),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ containers: ['c2'] }),
            );
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 and not call triggerBatch when the trigger reports unbatchable containers', async () => {
            const c1 = buildContainer({ id: 'c1' });
            const c2 = buildContainer({ id: 'c2' });
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => (id === 'c1' ? c1 : c2),
            );
            mockGetUnbatchable.mockResolvedValue([c2]);

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({ containers: ['c2'] }),
            );
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 200 and call triggerBatch once with the resolved containers', async () => {
            const c1 = buildContainer({ id: 'c1' });
            const c2 = buildContainer({ id: 'c2' });
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => (id === 'c1' ? c1 : c2),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockTriggerBatch).toHaveBeenCalledTimes(1);
            expect(mockTriggerBatch).toHaveBeenCalledWith([c1, c2]);
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({});
        });

        test('should resolve an agent-scoped trigger and accept matching agent containers', async () => {
            const agentTriggerBatch = jest.fn().mockResolvedValue(undefined);
            (registry.getState as jest.Mock).mockReturnValue({
                trigger: {
                    'remote.docker.update': {
                        triggerBatch: agentTriggerBatch,
                        getUnbatchableContainers: jest
                            .fn()
                            .mockResolvedValue([]),
                    },
                },
            });
            const c1 = buildContainer({ id: 'c1', agent: 'remote' });
            const c2 = buildContainer({ id: 'c2', agent: 'remote' });
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => (id === 'c1' ? c1 : c2),
            );

            await callHandler(
                {
                    triggerAgent: 'remote',
                    triggerType: 'docker',
                    triggerName: 'update',
                },
                { containerIds: ['c1', 'c2'] },
            );

            expect(agentTriggerBatch).toHaveBeenCalledWith([c1, c2]);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        test('should return 500 when triggerBatch rejects', async () => {
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => buildContainer({ id }),
            );
            mockTriggerBatch.mockReset().mockRejectedValue(new Error('boom'));

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('boom'),
                }),
            );
        });
    });
});
