import {
  getAllContainers,
  refreshAllContainers,
  refreshContainer,
  deleteContainer,
  getContainerTriggers,
  runTrigger
} from '@/services/container';

// Mock fetch globally
const fetchMock = jest.fn();
global.fetch = fetchMock as unknown as typeof fetch;

describe('Container Service', () => {
  beforeEach(() => {
    fetchMock.mockClear();
  });

  describe('getAllContainers', () => {
    it('fetches all containers successfully', async () => {
      const mockContainers = [
        { id: '1', name: 'container1' },
        { id: '2', name: 'container2' }
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockContainers
      });

      const containers = await getAllContainers();

      expect(fetch).toHaveBeenCalledWith('/api/containers', {
        credentials: 'include'
      });
      expect(containers).toEqual(mockContainers);
    });
  });

  describe('refreshAllContainers', () => {
    it('refreshes all containers successfully', async () => {
      const mockResult = { refreshed: 10 };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await refreshAllContainers();

      expect(fetch).toHaveBeenCalledWith('/api/containers/watch', {
        method: 'POST',
        credentials: 'include'
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('refreshContainer', () => {
    it('refreshes specific container successfully', async () => {
      const mockResult = { id: 'container1', refreshed: true };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await refreshContainer('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/watch', {
        method: 'POST',
        credentials: 'include'
      });
      expect(result).toEqual(mockResult);
    });

    it('returns undefined when container not found', async () => {
      fetchMock.mockResolvedValueOnce({
        status: 404
      });

      const result = await refreshContainer('nonexistent');

      expect(result).toBeUndefined();
    });
  });

  describe('deleteContainer', () => {
    it('deletes container successfully', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true
      });

      const result = await deleteContainer('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1', {
        method: 'DELETE',
        credentials: 'include'
      });
      expect(result).toBeDefined();
    });
  });

  describe('getContainerTriggers', () => {
    it('fetches container triggers successfully', async () => {
      const mockTriggers = [
        { type: 'webhook', name: 'trigger1' },
        { type: 'email', name: 'trigger2' }
      ];
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTriggers
      });

      const triggers = await getContainerTriggers('container1');

      expect(fetch).toHaveBeenCalledWith('/api/containers/container1/triggers', {
        credentials: 'include'
      });
      expect(triggers).toEqual(mockTriggers);
    });
  });

  describe('runTrigger', () => {
    it('runs trigger successfully', async () => {
      const mockResult = { success: true, message: 'Trigger executed' };
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => mockResult
      });

      const result = await runTrigger({
        containerId: 'container1',
        triggerType: 'webhook',
        triggerName: 'trigger1'
      });

      expect(fetch).toHaveBeenCalledWith(
        '/api/containers/container1/triggers/webhook/trigger1',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        }
      );
      expect(result).toEqual(mockResult);
    });

    it('rejects with the reason carried by the error body', async () => {
      const reason =
        'Container c1 cannot be updated by this trigger (no compose file could be resolved)';
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({ error: reason })
      });

      await expect(
        runTrigger({
          containerId: 'container1',
          triggerType: 'webhook',
          triggerName: 'trigger1'
        })
      ).rejects.toThrow(new Error(reason));
    });

    it('falls back to the status text when the error body is not JSON', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        statusText: 'Bad Gateway',
        json: jest.fn().mockRejectedValue(new Error('not json'))
      });

      await expect(
        runTrigger({
          containerId: 'container1',
          triggerType: 'webhook',
          triggerName: 'trigger1'
        })
      ).rejects.toThrow(
        new Error('Failed to run trigger webhook/trigger1: Bad Gateway')
      );
    });
  });
});