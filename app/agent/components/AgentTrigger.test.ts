// @ts-nocheck
import AgentTrigger from './AgentTrigger';
import { getAgent } from '../manager';

jest.mock('../manager');

describe('AgentTrigger', () => {
    let trigger;
    const mockClient = {
        runRemoteTrigger: jest.fn(),
        runRemoteTriggerBatch: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        trigger = new AgentTrigger();
        trigger.type = 'docker';
        trigger.name = 'test';
        trigger.agent = 'agent1';
    });

    test('should delegate trigger to agent client', async () => {
        const container = { id: 'c1' };
        // @ts-ignore
        getAgent.mockReturnValue(mockClient);
        mockClient.runRemoteTrigger.mockResolvedValue({ success: true });

        const result = await trigger.trigger(container);

        expect(getAgent).toHaveBeenCalledWith('agent1');
        expect(mockClient.runRemoteTrigger).toHaveBeenCalledWith(
            container,
            'docker',
            'test',
        );
        expect(result).toEqual({ success: true });
    });

    test('should throw error if agent not assigned', async () => {
        trigger.agent = undefined;
        await expect(trigger.trigger({})).rejects.toThrow(
            'AgentTrigger must have an agent assigned',
        );
    });

    test('should throw error if agent client not found', async () => {
        // @ts-ignore
        getAgent.mockReturnValue(undefined);
        await expect(trigger.trigger({})).rejects.toThrow(
            'Agent agent1 not found',
        );
    });

    test('should delegate triggerBatch to agent client', async () => {
        const containers = [{ id: 'c1' }, { id: 'c2' }];
        // @ts-ignore
        getAgent.mockReturnValue(mockClient);
        mockClient.runRemoteTriggerBatch.mockResolvedValue({ success: true });

        const result = await trigger.triggerBatch(containers);

        expect(getAgent).toHaveBeenCalledWith('agent1');
        expect(mockClient.runRemoteTriggerBatch).toHaveBeenCalledWith(
            containers,
            'docker',
            'test',
        );
        expect(result).toEqual({ success: true });
    });

    test('should return relaxed configuration schema', () => {
        const schema = trigger.getConfigurationSchema();
        expect(schema.validate({ anything: 'goes' }).error).toBeUndefined();
    });
});
