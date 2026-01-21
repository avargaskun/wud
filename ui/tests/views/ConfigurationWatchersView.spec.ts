import ConfigurationWatchersView from '@/views/ConfigurationWatchersView.vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import ConfigurationItem from '@/components/ConfigurationItem.vue';
import { getAllWatchers } from "@/services/watcher";
import agentService from "@/services/agent";

jest.mock("@/services/watcher", () => ({
  getAllWatchers: jest.fn(),
}));

jest.mock('@/services/agent', () => ({
  __esModule: true, 
  default: {
    getAgents: jest.fn(),
  },
}));

describe('ConfigurationWatchersView', () => {
  let mockWatchers: any[];
  let mockAgents: any[];

  beforeEach(() => {
    mockWatchers = [
      { id: '1', type: 'docker', name: 'local', configuration: {} },
      { id: '2', type: 'docker', name: 'remote', agent: 'agent1', configuration: {} },
    ];
    mockAgents = [
      { name: 'agent1', connected: true },
      { name: 'agent2', connected: false },
    ];
    jest.clearAllMocks();
    (getAllWatchers as jest.Mock).mockResolvedValue(mockWatchers);
    (agentService.getAgents as jest.Mock).mockResolvedValue(mockAgents);
  });

  it('renders correctly and fetches watchers and agents on beforeRouteEnter', async () => {
    const nextFn = jest.fn();
    await (ConfigurationWatchersView as any).beforeRouteEnter({} as any, {} as any, nextFn);

    const vm: any = {};
    nextFn.mock.calls[0][0](vm);

    expect(vm.watchers).toEqual(mockWatchers);
    const wrapper = mount(ConfigurationWatchersView, {
      global: {
        components: {
          ConfigurationItem,
        },
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });

    // Set the data explicitly as shallowMount doesn't call beforeRouteEnter
    await wrapper.setData({ watchers: mockWatchers, agents: mockAgents });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findAllComponents(ConfigurationItem).length).toBe(2);

    const firstWatcherItem = wrapper.findAllComponents(ConfigurationItem)[0];
    expect(firstWatcherItem.props('item')).toEqual(mockWatchers[0]);
    expect(firstWatcherItem.props('agents')).toEqual(mockAgents);

    const secondWatcherItem = wrapper.findAllComponents(ConfigurationItem)[1];
    expect(secondWatcherItem.props('item')).toEqual(mockWatchers[1]);
    expect(secondWatcherItem.props('agents')).toEqual(mockAgents);
  });

  it('displays "No watchers configured" when no watchers are present', async () => {
    (getAllWatchers as jest.Mock).mockResolvedValue([]);

    const nextFn = jest.fn();
    await (ConfigurationWatchersView as any).beforeRouteEnter({} as any, {} as any, nextFn);

    const vm: any = {};
    nextFn.mock.calls[0][0](vm);

    const wrapper = mount(ConfigurationWatchersView, {
      global: {
        components: {
          ConfigurationItem,
        },
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });

    await wrapper.setData({ watchers: [], agents: mockAgents });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findComponent(ConfigurationItem).exists()).toBe(false);
    expect(wrapper.find('.v-card-subtitle').text()).toContain('No watchers configured');
  });

  it('emits notify event on error during data fetching', async () => {
    const errorMessage = 'Failed to load watchers';
    (getAllWatchers as jest.Mock).mockRejectedValue(new Error(errorMessage));

    const nextFn = jest.fn();
    const mockEventBus = { emit: jest.fn() };
    await (ConfigurationWatchersView as any).beforeRouteEnter({} as any, {} as any, nextFn);

    const vm: any = { $eventBus: mockEventBus };
    nextFn.mock.calls[0][0](vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      `Error when trying to load the watchers (${errorMessage})`,
      'error',
    );
  });
});