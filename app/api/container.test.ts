import { getContainerTriggers } from './container';
import * as storeContainer from '../store/container';
import * as registry from '../registry';
import { mapComponentsToList } from './component';
import Trigger from '../triggers/providers/Trigger';

jest.mock('../store/container');
jest.mock('../registry');
jest.mock('./component');
jest.mock('../triggers/providers/Trigger');

describe('Container API', () => {
    const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        sendStatus: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (registry.getState as jest.Mock).mockReturnValue({ trigger: {} });

        // Mock Trigger.parseIncludeOrIncludeTriggerString to behave somewhat realistically or predictably
        (
            Trigger.parseIncludeOrIncludeTriggerString as jest.Mock
        ).mockImplementation((str) => {
            const parts = str.split(':');
            return {
                id: parts[0],
                threshold: parts[1] || 'all',
            };
        });
    });

    describe('getContainerTriggers', () => {
        test('should return 404 if container is not found', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                undefined,
            );
            const req = { params: { id: 'unknown' } };

            await getContainerTriggers(req, mockRes);

            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return all local triggers for a local container when no include/exclude', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 't1', configuration: {} },
                { type: 'slack', name: 't2', configuration: {} },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.status).toHaveBeenCalledWith(200);
            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ type: 'docker', name: 't1' }),
                expect.objectContaining({ type: 'slack', name: 't2' }),
            ]);
        });

        test('should not return remote triggers for a local container', async () => {
            const container = { id: 'c1' }; // Local container (no agent)
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 'local1', configuration: {} },
                {
                    type: 'docker',
                    name: 'remote1',
                    agent: 'agent1',
                    configuration: {},
                },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 'local1' }),
            ]);
            // remote1 should be filtered out
        });

        test('should return remote triggers for a remote container on the same agent', async () => {
            const container = { id: 'c1', agent: 'agent1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 'local1', configuration: {} }, // Local triggers apply to remote containers (proxied)
                {
                    type: 'docker',
                    name: 'remote1',
                    agent: 'agent1',
                    configuration: {},
                }, // Same agent
                {
                    type: 'docker',
                    name: 'remote2',
                    agent: 'agent2',
                    configuration: {},
                }, // Different agent
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 'local1' }),
                    expect.objectContaining({ name: 'remote1' }),
                ]),
            );
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.not.arrayContaining([
                    expect.objectContaining({ name: 'remote2' }),
                ]),
            );
        });

        test('should filter triggers based on triggerInclude', async () => {
            const container = {
                id: 'c1',
                triggerInclude: 'docker.t1',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 't1', configuration: {} },
                { type: 'docker', name: 't2', configuration: {} },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 't1' }),
            ]);
        });

        test('should apply threshold from triggerInclude', async () => {
            const container = {
                id: 'c1',
                triggerInclude: 'docker.t1:major',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                {
                    type: 'docker',
                    name: 't1',
                    configuration: { threshold: 'all' },
                },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({
                    name: 't1',
                    configuration: expect.objectContaining({
                        threshold: 'major',
                    }),
                }),
            ]);
        });

        test('should filter triggers based on triggerExclude', async () => {
            const container = {
                id: 'c1',
                triggerExclude: 'docker.t1',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 't1', configuration: {} },
                { type: 'docker', name: 't2', configuration: {} },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 't2' }),
            ]);
        });

        test('should handle both include and exclude', async () => {
            const container = {
                id: 'c1',
                triggerInclude: 'docker.t1, docker.t2',
                triggerExclude: 'docker.t2',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 't1', configuration: {} },
                { type: 'docker', name: 't2', configuration: {} },
                { type: 'docker', name: 't3', configuration: {} },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 't1' }),
            ]);
            // t2 excluded explicitly, t3 not in include list
        });

        test('should handle spaces in include/exclude strings', async () => {
            const container = {
                id: 'c1',
                triggerInclude: 'docker.t1 , docker.t2',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                { type: 'docker', name: 't1', configuration: {} },
                { type: 'docker', name: 't2', configuration: {} },
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 't1' }),
                    expect.objectContaining({ name: 't2' }),
                ]),
            );
        });

        test('should handle triggerInclude for remote container with matching remote and local triggers', async () => {
            const container = {
                id: 'c1',
                agent: 'agent1',
                triggerInclude: 'docker.t1, docker.t2',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                {
                    type: 'docker',
                    name: 't1',
                    agent: 'agent1',
                    configuration: {},
                }, // Remote matching
                { type: 'docker', name: 't2', configuration: {} }, // Local matching
                {
                    type: 'docker',
                    name: 't3',
                    agent: 'agent1',
                    configuration: {},
                }, // Remote not in include
                { type: 'docker', name: 't4', configuration: {} }, // Local not in include
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 't1', agent: 'agent1' }),
                expect.objectContaining({ name: 't2' }),
            ]);
        });

        test('should handle triggerExclude for remote container with matching remote and local triggers', async () => {
            const container = {
                id: 'c1',
                agent: 'agent1',
                triggerExclude: 'docker.t1, docker.t2',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                {
                    type: 'docker',
                    name: 't1',
                    agent: 'agent1',
                    configuration: {},
                }, // Remote matching (exclude)
                { type: 'docker', name: 't2', configuration: {} }, // Local matching (exclude)
                {
                    type: 'docker',
                    name: 't3',
                    agent: 'agent1',
                    configuration: {},
                }, // Remote (not excluded)
                { type: 'docker', name: 't4', configuration: {} }, // Local (not excluded)
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith(
                expect.arrayContaining([
                    expect.objectContaining({ name: 't3', agent: 'agent1' }),
                    expect.objectContaining({ name: 't4' }),
                ]),
            );
            expect(mockRes.json).toHaveBeenCalledWith(
                expect.not.arrayContaining([
                    expect.objectContaining({ name: 't1' }),
                    expect.objectContaining({ name: 't2' }),
                ]),
            );
        });

        test('should skip remote triggers from other agents even if they match triggerInclude', async () => {
            const container = {
                id: 'c1',
                agent: 'agent1',
                triggerInclude: 'docker.t1',
            };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            const triggers = [
                {
                    type: 'docker',
                    name: 't1',
                    agent: 'agent2',
                    configuration: {},
                }, // Different agent
            ];
            (mapComponentsToList as jest.Mock).mockReturnValue(triggers);

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([]);
        });
    });
});
