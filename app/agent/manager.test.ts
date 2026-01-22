import { getAgents, getAgent, addAgent } from './manager';
import { AgentClient } from './AgentClient';

jest.mock('./AgentClient');

describe('manager', () => {
    beforeEach(() => {
        // Reset the internal clients array for each test.
        // Since it's a module-level constant, we might need a way to clear it if tests interfere.
        // Currently manager doesn't export a clear function.
        const agents = getAgents();
        agents.length = 0;
    });

    test('should add and get agents', () => {
        const mockClient = new AgentClient('test-agent', {
            host: 'host',
            port: 3000,
            secret: 'secret',
        }) as jest.Mocked<AgentClient>;
        mockClient.name = 'test-agent';

        addAgent(mockClient);

        expect(getAgents()).toHaveLength(1);
        expect(getAgent('test-agent')).toBe(mockClient);
    });

    test('should return undefined if agent not found', () => {
        expect(getAgent('unknown')).toBeUndefined();
    });
});
