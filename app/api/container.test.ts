import { Request, Response } from 'express';
import {
    getContainerTriggers,
    runTrigger,
    runTriggerBatch,
} from './container.handlers';
import * as storeContainer from '../store/container';
import * as registry from '../registry';
import Trigger from '../triggers/providers/Trigger';
import { Container } from '../model/container';

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

    describe('runTrigger', () => {
        const mockTrigger = jest.fn();

        const buildContainer = (overrides = {}) => ({
            id: 'c1',
            name: 'c1',
            watcher: 'local',
            image: { tag: { value: '1.0.0' } },
            result: { tag: '2.0.0' },
            updateAvailable: true,
            updateKind: {
                kind: 'tag',
                localValue: '1.0.0',
                remoteValue: '2.0.0',
                semverDiff: 'major',
            },
            updates: {
                patch: {
                    kind: 'tag',
                    localValue: '1.0.0',
                    remoteValue: '1.0.1',
                    semverDiff: 'patch',
                },
                major: {
                    kind: 'tag',
                    localValue: '1.0.0',
                    remoteValue: '2.0.0',
                    semverDiff: 'major',
                },
            },
            ...overrides,
        });

        const callHandler = (params: Record<string, string>, body: unknown) =>
            runTrigger(
                { params, body } as unknown as Request,
                mockRes as unknown as Response,
            );

        beforeEach(() => {
            const RealTrigger = jest.requireActual(
                '../triggers/providers/Trigger',
            ).default;
            (Trigger.buildTriggerView as jest.Mock).mockImplementation(
                RealTrigger.buildTriggerView,
            );
            mockTrigger.mockReset().mockResolvedValue(undefined);
            (registry.getState as jest.Mock).mockReturnValue({
                trigger: {
                    'docker.update': { trigger: mockTrigger },
                },
            });
        });

        test('should return 404 when the container is not found', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                undefined,
            );

            await callHandler(
                { id: 'unknown', triggerType: 'docker', triggerName: 'update' },
                {},
            );

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Container not found',
            });
            expect(mockTrigger).not.toHaveBeenCalled();
        });

        test('should return 404 when the trigger is not found', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer(),
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'nope' },
                {},
            );

            expect(mockRes.status).toHaveBeenCalledWith(404);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'Trigger not found',
            });
            expect(mockTrigger).not.toHaveBeenCalled();
        });

        test('should pass the raw stored container when the body is missing', async () => {
            const container = buildContainer();
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                undefined,
            );

            expect(mockTrigger).toHaveBeenCalledTimes(1);
            expect(mockTrigger.mock.calls[0][0]).toBe(container);
            expect(Trigger.buildTriggerView).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({});
        });

        test('should pass the raw stored container when the body is empty', async () => {
            const container = buildContainer();
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                {},
            );

            expect(mockTrigger).toHaveBeenCalledTimes(1);
            expect(mockTrigger.mock.calls[0][0]).toBe(container);
            expect(Trigger.buildTriggerView).not.toHaveBeenCalled();
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        test('should return 400 for an invalid bucket value', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer(),
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                { bucket: 'nonsense' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'bucket must be one of major, minor, patch, digest',
            });
            expect(mockTrigger).not.toHaveBeenCalled();
        });

        test('should return 400 when the requested bucket is absent', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer({ updates: {} }),
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                { bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: "Container has no populated 'patch' update",
            });
            expect(mockTrigger).not.toHaveBeenCalled();
        });

        test('should return 400 when the requested bucket is null', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer({ updates: { patch: null } }),
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                { bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: "Container has no populated 'patch' update",
            });
            expect(mockTrigger).not.toHaveBeenCalled();
        });

        test('should trigger with the bucket view when the bucket is populated', async () => {
            const container = buildContainer() as unknown as Container;
            const originalUpdateKind = container.updateKind;
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                { bucket: 'patch' },
            );

            expect(mockTrigger).toHaveBeenCalledTimes(1);
            const view = mockTrigger.mock.calls[0][0];
            expect(view).not.toBe(container);
            expect(view.updateKind.remoteValue).toBe(
                container.updates.patch.remoteValue,
            );
            expect(view.selectedUpdate).toBe(container.updates.patch);
            expect(view.updateAvailable).toBe(true);
            expect(container.updateKind).toBe(originalUpdateKind);
            expect(container.selectedUpdate).toBeUndefined();
            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({});
        });

        test('should resolve an agent-scoped trigger and apply the bucket view', async () => {
            const agentTrigger = jest.fn().mockResolvedValue(undefined);
            (registry.getState as jest.Mock).mockReturnValue({
                trigger: {
                    'agent1.docker.update': { trigger: agentTrigger },
                },
            });
            const container = buildContainer({
                agent: 'agent1',
            }) as unknown as Container;
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            await callHandler(
                {
                    id: 'c1',
                    triggerAgent: 'agent1',
                    triggerType: 'docker',
                    triggerName: 'update',
                },
                { bucket: 'patch' },
            );

            expect(agentTrigger).toHaveBeenCalledTimes(1);
            const view = agentTrigger.mock.calls[0][0];
            expect(view.updateKind.remoteValue).toBe(
                container.updates.patch.remoteValue,
            );
            expect(view.selectedUpdate).toBe(container.updates.patch);
            expect(view.updateAvailable).toBe(true);
            expect(mockRes.status).toHaveBeenCalledWith(200);
        });

        test('should return 500 when the trigger rejects on the bucket path', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer(),
            );
            mockTrigger.mockReset().mockRejectedValue(new Error('boom'));

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                { bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.stringContaining('boom'),
                }),
            );
        });

        test('should serialize the trigger run result in the 200 body', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer(),
            );
            const dependents = [
                {
                    name: 'sidecar',
                    host: 'c1',
                    status: 'bounced',
                    method: 'recreate',
                },
                {
                    name: 'ghost',
                    host: 'c1',
                    status: 'skipped',
                    reason: 'unresolved',
                },
            ];
            mockTrigger.mockReset().mockResolvedValue({ dependents });

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                {},
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ dependents });
        });

        test('should serialize the trigger run result on the bucket path', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer(),
            );
            mockTrigger.mockReset().mockResolvedValue({ dependents: [] });

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                { bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({ dependents: [] });
        });

        test('should respond with an empty body when the trigger returns nothing', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                buildContainer(),
            );
            mockTrigger.mockReset().mockResolvedValue(undefined);

            await callHandler(
                { id: 'c1', triggerType: 'docker', triggerName: 'update' },
                {},
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({});
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

        const patchUpdate = (remoteValue: string) => ({
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue,
            semverDiff: 'patch',
        });

        const wireRealBuildTriggerView = () => {
            const RealTrigger = jest.requireActual(
                '../triggers/providers/Trigger',
            ).default;
            (Trigger.buildTriggerView as jest.Mock).mockImplementation(
                RealTrigger.buildTriggerView,
            );
        };

        test('should return 400 for an invalid bucket value before container resolution', async () => {
            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'], bucket: 'nonsense' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'bucket must be one of major, minor, patch, digest',
            });
            expect(storeContainer.getContainer).not.toHaveBeenCalled();
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should return 400 listing members with an absent or null bucket', async () => {
            const c1 = buildContainer({
                id: 'c1',
                updates: { patch: patchUpdate('1.0.1') },
            });
            const c2 = buildContainer({ id: 'c2' });
            const c3 = buildContainer({ id: 'c3', updates: { patch: null } });
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => ({ c1, c2, c3 })[id],
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2', 'c3'], bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(400);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: "All containers must have a populated 'patch' update",
                containers: ['c2', 'c3'],
            });
            expect(mockGetUnbatchable).not.toHaveBeenCalled();
            expect(mockTriggerBatch).not.toHaveBeenCalled();
        });

        test('should call triggerBatch once with bucket views when all members are populated', async () => {
            wireRealBuildTriggerView();
            const c1 = buildContainer({
                id: 'c1',
                updates: { patch: patchUpdate('1.0.1') },
            }) as unknown as Container;
            const c2 = buildContainer({
                id: 'c2',
                updates: { patch: patchUpdate('1.0.2') },
            }) as unknown as Container;
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => (id === 'c1' ? c1 : c2),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'], bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockTriggerBatch).toHaveBeenCalledTimes(1);
            const views = mockTriggerBatch.mock.calls[0][0];
            expect(views).toHaveLength(2);
            expect(views[0]).not.toBe(c1);
            expect(views[1]).not.toBe(c2);
            expect(views[0].selectedUpdate).toBe(c1.updates.patch);
            expect(views[1].selectedUpdate).toBe(c2.updates.patch);
            expect(views[0].updateKind.remoteValue).toBe('1.0.1');
            expect(views[1].updateKind.remoteValue).toBe('1.0.2');
        });

        test('should pass the same array instance to getUnbatchableContainers and triggerBatch', async () => {
            wireRealBuildTriggerView();
            const c1 = buildContainer({
                id: 'c1',
                updates: { patch: patchUpdate('1.0.1') },
            });
            (storeContainer.getContainer as jest.Mock).mockReturnValue(c1);

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1'], bucket: 'patch' },
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockGetUnbatchable.mock.calls[0][0]).toBe(
                mockTriggerBatch.mock.calls[0][0],
            );
        });

        test('should pass the raw store containers to triggerBatch when bucket is omitted', async () => {
            const c1 = buildContainer({
                id: 'c1',
                updates: { patch: patchUpdate('1.0.1') },
            });
            const c2 = buildContainer({
                id: 'c2',
                updates: { patch: patchUpdate('1.0.2') },
            });
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => (id === 'c1' ? c1 : c2),
            );

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(Trigger.buildTriggerView).not.toHaveBeenCalled();
            const passed = mockTriggerBatch.mock.calls[0][0];
            expect(passed[0]).toBe(c1);
            expect(passed[1]).toBe(c2);
            expect(mockGetUnbatchable.mock.calls[0][0]).toBe(passed);
        });

        test('should serialize members and dependents in the 200 body', async () => {
            const c1 = buildContainer({ id: 'c1' });
            (storeContainer.getContainer as jest.Mock).mockReturnValue(c1);
            const result = {
                members: [{ id: 'c1', name: 'c1', status: 'updated' }],
                dependents: [
                    { name: 'sidecar', host: 'c1', status: 'skipped' },
                ],
            };
            mockTriggerBatch.mockReset().mockResolvedValue(result);

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith(result);
        });

        test('should return 500 with the result fields when a member failed', async () => {
            const c1 = buildContainer({ id: 'c1' });
            const c2 = buildContainer({ id: 'c2' });
            (storeContainer.getContainer as jest.Mock).mockImplementation(
                (id) => (id === 'c1' ? c1 : c2),
            );
            const members = [
                { id: 'c1', name: 'c1', status: 'updated' },
                { id: 'c2', name: 'c2', status: 'failed', error: 'boom' },
            ];
            mockTriggerBatch
                .mockReset()
                .mockResolvedValue({ members, dependents: [] });

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1', 'c2'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(500);
            expect(mockRes.json).toHaveBeenCalledWith({
                error: 'One or more batch members failed to update',
                members,
                dependents: [],
            });
        });

        test('should respond with an empty body when triggerBatch returns nothing', async () => {
            const c1 = buildContainer({ id: 'c1' });
            (storeContainer.getContainer as jest.Mock).mockReturnValue(c1);
            mockTriggerBatch.mockReset().mockResolvedValue(undefined);

            await callHandler(
                { triggerType: 'docker', triggerName: 'update' },
                { containerIds: ['c1'] },
            );

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith({});
        });
    });
});
