// @ts-nocheck
import AgentTrigger from './AgentTrigger';
import { getAgent } from '../manager';
import { getPostupdateBounceCounter } from '../../prometheus/postupdate';

jest.mock('../manager');
jest.mock('../../prometheus/postupdate');

describe('AgentTrigger', () => {
    let trigger;
    const mockCounter = { inc: jest.fn() };
    const mockClient = {
        runRemoteTrigger: jest.fn(),
        runRemoteTriggerBatch: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        // @ts-ignore
        getPostupdateBounceCounter.mockReturnValue(mockCounter);
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

    test('should increment the postupdate counter once per returned dependent', async () => {
        getAgent.mockReturnValue(mockClient);
        mockClient.runRemoteTrigger.mockResolvedValue({
            dependents: [
                { name: 'a', host: 'h', status: 'bounced' },
                { name: 'b', host: 'h', status: 'skipped' },
            ],
        });

        await trigger.trigger({ id: 'c1' });

        expect(mockCounter.inc).toHaveBeenCalledTimes(2);
        expect(mockCounter.inc).toHaveBeenNthCalledWith(1, {
            type: 'docker',
            name: 'test',
            status: 'bounced',
        });
        expect(mockCounter.inc).toHaveBeenNthCalledWith(2, {
            type: 'docker',
            name: 'test',
            status: 'skipped',
        });
    });

    test('should increment the postupdate counter for batch dependents', async () => {
        getAgent.mockReturnValue(mockClient);
        mockClient.runRemoteTriggerBatch.mockResolvedValue({
            members: [{ id: 'c1', name: 'c1', status: 'updated' }],
            dependents: [{ name: 'a', host: 'c1', status: 'failed' }],
        });

        await trigger.triggerBatch([{ id: 'c1' }]);

        expect(mockCounter.inc).toHaveBeenCalledTimes(1);
        expect(mockCounter.inc).toHaveBeenCalledWith({
            type: 'docker',
            name: 'test',
            status: 'failed',
        });
    });

    test('should not increment the counter when the agent returns no dependents', async () => {
        getAgent.mockReturnValue(mockClient);
        mockClient.runRemoteTrigger.mockResolvedValue({});
        await trigger.trigger({ id: 'c1' });

        mockClient.runRemoteTrigger.mockResolvedValue(undefined);
        await trigger.trigger({ id: 'c1' });

        expect(mockCounter.inc).not.toHaveBeenCalled();
    });

    test('should not throw when Prometheus is not initialized', async () => {
        getAgent.mockReturnValue(mockClient);
        getPostupdateBounceCounter.mockReturnValue(undefined);
        mockClient.runRemoteTrigger.mockResolvedValue({
            dependents: [{ name: 'a', host: 'h', status: 'bounced' }],
        });

        await expect(trigger.trigger({ id: 'c1' })).resolves.toEqual({
            dependents: [{ name: 'a', host: 'h', status: 'bounced' }],
        });
    });

    test('should return relaxed configuration schema', () => {
        const schema = trigger.getConfigurationSchema();
        expect(schema.validate({ anything: 'goes' }).error).toBeUndefined();
    });
});
