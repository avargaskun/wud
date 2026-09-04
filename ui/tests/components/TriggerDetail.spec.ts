import TriggerDetail from '@/components/TriggerDetail.vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RouterLinkStub } from '@vue/test-utils';
import { runTrigger } from "@/services/trigger";

jest.mock("@/services/trigger", () => ({
  runTrigger: jest.fn(),
}));

jest.mock('@/services/agent', () => ({
  default: {
    getAgents: jest.fn(),
  },
}));

describe('TriggerDetail', () => {
  let trigger: any;
  let agents: any[];

  beforeEach(() => {
    trigger = {
      id: '1',
      type: 'webhook',
      name: 'my-webhook',
      icon: 'mdi-webhook',
      configuration: {
        url: 'http://localhost/webhook',
      },
    };
    agents = [
      { name: 'agent1', connected: true },
      { name: 'agent2', connected: false },
    ];
    jest.clearAllMocks();
  });

  it('renders correctly with default props', () => {
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('.v-card').exists()).toBe(true);
    expect(wrapper.find('.v-card-title').exists()).toBe(true);
    expect(wrapper.findAll('.v-chip').filter(i => i.text().trim() == 'webhook').length).toBe(1);
    expect(wrapper.findAll('.v-chip').filter(i => i.text().trim() == 'my-webhook').length).toBe(1);
  });

  it('toggles detail view on click', async () => {
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    await wrapper.find('.v-card-title').trigger('click');
    expect(wrapper.vm.showDetail).toBe(true);

    await wrapper.find('.v-card-title').trigger('click');
    expect(wrapper.vm.showDetail).toBe(false);
  });

  it('displays agent name and status when trigger has an agent', () => {
    trigger.agent = 'agent1';
    const wrapper = mount(TriggerDetail, {
      props: { trigger, agents },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    expect(wrapper.find('.v-chip').text()).toContain('agent1');
    expect(wrapper.find('.v-chip').attributes('color')).toBe('success');
  });

  it('displays correct color for disconnected agent', () => {
    trigger.agent = 'agent2';
    const wrapper = mount(TriggerDetail, {
      props: { trigger, agents },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    expect(wrapper.find('.v-chip').text()).toContain('agent2');
    expect(wrapper.find('.v-chip').attributes('color')).toBe('error');
  });

  it('displays configuration items', async () => {
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    expect(wrapper.find('.v-list').exists()).toBe(true);
    expect(wrapper.findAll('.v-list-item').length).toBe(1);
    expect(wrapper.findAll('.v-list-item')[0].text()).toContain('url');
    expect(wrapper.findAll('.v-list-item')[0].text()).toContain('http://localhost/webhook');
  });

  it('opens test form', async () => {
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });

    await wrapper.find('.v-card-title').trigger('click'); // Expand detail
    const testButton = wrapper.find('.v-btn');
    expect(testButton.text()).toContain('Test');

    await testButton.trigger('click');
    expect(wrapper.vm.showTestForm).toBe(true);
  });

  it('runs trigger with default container data', async () => {
    const eventBus = { emit: jest.fn() };
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
        mocks: {
          $eventBus: eventBus,
        },
      },
    });
    (runTrigger as jest.Mock).mockResolvedValue({});

    await wrapper.find('.v-card-title').trigger('click'); // Expand detail
    await wrapper.findAll('.v-btn').at(0).trigger('click'); // Open test form

    const runButton = wrapper.findAll('.v-btn').at(1);
    expect(runButton?.text()).toContain('Run trigger');

    await runButton?.trigger('click');

    expect(runTrigger).toHaveBeenCalledWith({
      triggerType: 'webhook',
      triggerName: 'my-webhook',
      container: {
        id: '123456789',
        name: 'container_test',
        watcher: 'watcher_test',
        updateKind: {
          kind: 'tag',
          semverDiff: 'major',
          localValue: '1.2.3',
          remoteValue: '4.5.6',
          result: {
            link: 'https://my-container/release-notes/',
          },
        },
      },
    });
    expect(eventBus.emit).toHaveBeenCalledWith("notify", "Trigger executed with success");
    expect(wrapper.vm.isTriggering).toBe(false);
  });

  it('handles trigger execution error', async () => {
    const eventBus = { emit: jest.fn() };
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
        mocks: {
          $eventBus: eventBus,
        },
      },
    });
    const errorMessage = 'Network Error';
    (runTrigger as jest.Mock).mockRejectedValue(new Error(errorMessage));

    await wrapper.find('.v-card-title').trigger('click'); // Expand detail
    await wrapper.findAll('.v-btn').at(0).trigger('click'); // Open test form

    const runButton = wrapper.findAll('.v-btn').at(1);
    await runButton?.trigger('click');

    expect(runTrigger).toHaveBeenCalled();
    expect(eventBus.emit).toHaveBeenCalledWith("notify", `Trigger executed with error (${errorMessage}})`,
    "error",
    );
    expect(wrapper.vm.isTriggering).toBe(false);
  });

  it('formats empty values as "<empty>"', async () => {
    trigger.configuration.emptyValue = null;
    trigger.configuration.anotherEmpty = '';
    const wrapper = mount(TriggerDetail, {
      props: { trigger },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await wrapper.find('.v-card-title').trigger('click');
    const listItems = wrapper.findAll('.v-list-item');
    expect(listItems.filter(i => i.text().includes('emptyValue'))[0].text()).toContain('<empty>');
    expect(listItems.filter(i => i.text().includes('anotherEmpty'))[0].text()).toContain('<empty>');
  });

  it('renders router-link for agent if present', async () => {
    trigger.agent = 'agent1';
    const wrapper = mount(TriggerDetail, {
      props: { trigger, agents },
      global: {
        stubs: {
          RouterLink: RouterLinkStub,
        },
      },
    });
    await wrapper.find('.v-card-title').trigger('click');
    const agentListItem = wrapper.findAll('.v-list-item').filter(item => item.text().includes('Agent'))[0];
    expect(agentListItem.findComponent(RouterLinkStub).props().to).toBe('/configuration/agents');
    expect(agentListItem.findComponent(RouterLinkStub).text()).toBe('agent1');
  });
});