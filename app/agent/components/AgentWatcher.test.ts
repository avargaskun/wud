// @ts-nocheck
import AgentWatcher from './AgentWatcher';
import { getAgent } from '../manager';

jest.mock('../manager');

describe('AgentWatcher', () => {
    let watcher;
    const mockClient = {};

    beforeEach(() => {
        jest.clearAllMocks();
        watcher = new AgentWatcher();
        watcher.agent = 'agent1';
        watcher.type = 'docker';
        watcher.name = 'remote';
    });

    test('should delegate to client.watch()', async () => {
        // @ts-ignore
        mockClient.watch = jest.fn().mockResolvedValue(['c1']);
        // @ts-ignore
        getAgent.mockReturnValue(mockClient);

        const result = await watcher.watch();

        expect(getAgent).toHaveBeenCalledWith('agent1');
        expect(mockClient.watch).toHaveBeenCalledWith('docker', 'remote');
        expect(result).toEqual(['c1']);
    });

    test('should throw error in watch() if agent not assigned', async () => {
        watcher.agent = undefined;
        await expect(watcher.watch()).rejects.toThrow(
            'AgentWatcher must have an agent assigned',
        );
    });

    test('should throw error in watch() if agent client not found', async () => {
        // @ts-ignore
        getAgent.mockReturnValue(undefined);
        await expect(watcher.watch()).rejects.toThrow('Agent agent1 not found');
    });

    test('should delegate to client.watchContainer()', async () => {
        const container = { id: 'c1' };
        // @ts-ignore
        mockClient.watchContainer = jest.fn().mockResolvedValue('result');
        // @ts-ignore
        getAgent.mockReturnValue(mockClient);

        const result = await watcher.watchContainer(container);

        expect(getAgent).toHaveBeenCalledWith('agent1');
        expect(mockClient.watchContainer).toHaveBeenCalledWith(
            'docker',
            'remote',
            container,
        );
        expect(result).toBe('result');
    });

    test('should return relaxed configuration schema', () => {
        const schema = watcher.getConfigurationSchema();
        expect(schema.validate({ anything: 'goes' }).error).toBeUndefined();
    });
});
