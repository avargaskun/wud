// @ts-nocheck
import AgentWatcher from './AgentWatcher';
import { getAgent } from './manager';

jest.mock('./manager');

describe('AgentWatcher', () => {
    let watcher;
    const mockClient = {};

    beforeEach(() => {
        jest.clearAllMocks();
        watcher = new AgentWatcher();
        watcher.agent = 'agent1';
    });

    test('should return empty array in watch()', async () => {
        // @ts-ignore
        getAgent.mockReturnValue(mockClient);
        const result = await watcher.watch();
        expect(result).toEqual([]);
        expect(getAgent).toHaveBeenCalledWith('agent1');
    });

    test('should throw error in watch() if agent not assigned', async () => {
        watcher.agent = undefined;
        await expect(watcher.watch()).rejects.toThrow('AgentWatcher must have an agent assigned');
    });

    test('should throw error in watch() if agent client not found', async () => {
        // @ts-ignore
        getAgent.mockReturnValue(undefined);
        await expect(watcher.watch()).rejects.toThrow('Agent agent1 not found');
    });

    test('should return container in watchContainer()', async () => {
        const container = { id: 'c1' };
        const result = await watcher.watchContainer(container);
        expect(result).toBe(container);
    });

    test('should return relaxed configuration schema', () => {
        const schema = watcher.getConfigurationSchema();
        expect(schema.validate({ anything: 'goes' }).error).toBeUndefined();
    });
});
