import agentService, { getAgents, getAgentIcon } from '@/services/agent';

describe('Agent Service', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  it('should return agent icon', () => {
    expect(getAgentIcon()).toBe('mdi-lan');
  });

  it('should get agents', async () => {
    const mockAgents = [{ id: '1', name: 'agent1' }];
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockAgents),
    });

    const result = await getAgents();

    expect(global.fetch).toHaveBeenCalledWith('/api/agents', { credentials: 'include' });
    expect(result).toEqual(mockAgents);
  });

  it('should get agents via default export', async () => {
    const mockAgents = [{ id: '1', name: 'agent1' }];
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockAgents),
    });

    const result = await agentService.getAgents();

    expect(global.fetch).toHaveBeenCalledWith('/api/agents', { credentials: 'include' });
    expect(result).toEqual(mockAgents);
  });

  it('should throw error when response is not ok', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      statusText: 'Internal Server Error',
    });

    await expect(getAgents()).rejects.toThrow('Failed to get agents: Internal Server Error');
  });
});
