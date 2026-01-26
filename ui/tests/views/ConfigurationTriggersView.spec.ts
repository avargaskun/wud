import ConfigurationTriggersView from '@/views/ConfigurationTriggersView.vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import TriggerDetail from '@/components/TriggerDetail.vue';
import { getAllTriggers } from "@/services/trigger";
import agentService from "@/services/agent";


jest.mock("@/services/trigger", () => ({
  getAllTriggers: jest.fn(),
}));

jest.mock('@/services/agent', () => ({
  __esModule: true, 
  default: {
    getAgents: jest.fn(),
  },
}));

describe('ConfigurationTriggersView', () => {
  let mockTriggers: any[];
  let mockAgents: any[];

  beforeEach(() => {
    mockTriggers = [
      { id: '1', type: 'webhook', name: 'my-webhook', configuration: {} },
      { id: '2', type: 'docker', name: 'remote-trigger', agent: 'agent1', configuration: {} },
    ];
    mockAgents = [
      { name: 'agent1', connected: true },
      { name: 'agent2', connected: false },
    ];

    (getAllTriggers as jest.Mock<any>).mockResolvedValue(mockTriggers);
    (agentService.getAgents as jest.Mock<any>).mockResolvedValue(mockAgents);
  });

  it('renders correctly and fetches triggers and agents on beforeRouteEnter', async () => {
    const nextFn = jest.fn();
    await (ConfigurationTriggersView as any).beforeRouteEnter({} as any, {} as any, nextFn);

    const vm: any = {};
    nextFn.mock.calls[0][0](vm);

    expect(vm.triggers).toEqual(mockTriggers);
    expect(vm.agents).toEqual(mockAgents);

    const wrapper = mount(ConfigurationTriggersView, {
      global: {
        components: {
          TriggerDetail,
        },
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });
    // Set the data explicitly as shallowMount doesn't call beforeRouteEnter
    await wrapper.setData({ triggers: mockTriggers, agents: mockAgents });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findAllComponents(TriggerDetail).length).toBe(2);

    const firstTriggerItem = wrapper.findAllComponents(TriggerDetail)[0];
    expect(firstTriggerItem.props('trigger')).toEqual(mockTriggers[0]);
    expect(firstTriggerItem.props('agents')).toEqual(mockAgents);

    const secondTriggerItem = wrapper.findAllComponents(TriggerDetail)[1];
    expect(secondTriggerItem.props('trigger')).toEqual(mockTriggers[1]);
    expect(secondTriggerItem.props('agents')).toEqual(mockAgents);
  });

  it('displays "No triggers configured" when no triggers are present', async () => {
    (getAllTriggers as jest.Mock).mockResolvedValue([]);

    const nextFn = jest.fn();
    await (ConfigurationTriggersView as any).beforeRouteEnter({} as any, {} as any, nextFn);

    const vm: any = {};
    nextFn.mock.calls[0][0](vm);

    const wrapper = mount(ConfigurationTriggersView, {
      global: {
        components: {
          TriggerDetail,
        },
        stubs: {
          'router-link': { template: '<a><slot /></a>' },
        },
      },
    });
    await wrapper.setData({ triggers: [], agents: mockAgents });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.findComponent(TriggerDetail).exists()).toBe(false);
    expect(wrapper.find('.v-card-subtitle').text()).toContain('No triggers configured');
  });

  it('emits notify event on error during data fetching', async () => {
    const errorMessage = 'Failed to load triggers';
    (getAllTriggers as jest.Mock).mockRejectedValue(new Error(errorMessage));

    const nextFn = jest.fn();
    const mockEventBus = { emit: jest.fn() };
    await (ConfigurationTriggersView as any).beforeRouteEnter({} as any, {} as any, nextFn);

    const vm: any = { $eventBus: mockEventBus };
    nextFn.mock.calls[0][0](vm);

    expect(vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      `Error when trying to load the triggers (${errorMessage})`,
      'error',
    );
  });
});