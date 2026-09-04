import ConfigurationItem from '@/components/ConfigurationItem.vue';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { RouterLinkStub } from '@vue/test-utils';

jest.mock('@/services/agent', () => ({
  default: {
    getAgents: jest.fn(),
  },
}));

describe('ConfigurationItem', () => {
  let item: any;
  let agents: any[];

  beforeEach(() => {
    item = {
      id: '1',
      type: 'docker',
      name: 'local',
      icon: 'mdi-docker',
      configuration: {
        host: 'unix:///var/run/docker.sock',
      },
    };
    agents = [
      { name: 'agent1', connected: true },
      { name: 'agent2', connected: false },
    ];
    jest.clearAllMocks();
  });

  const mountConfigItem = (props: Record<string, any> = {}) => {
    return mount(ConfigurationItem, {
      props: { ...props },
      global: {
        stubs: {
          IconRenderer: true,
          RouterLink: RouterLinkStub,
        },
      },
    });
  };

  it('renders correctly with default props', () => {
    const wrapper = mountConfigItem({ item });

    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('.v-card').exists()).toBe(true);
    expect(wrapper.find('.v-card-title').exists()).toBe(true);
    expect(wrapper.find('div.text-body-3').text()).toContain('docker');
    expect(wrapper.find('div.text-body-3').text()).toContain('local');

    const listItems = wrapper.findAll(".v-list-item");
    expect(listItems.length).toBe(1);
    expect(listItems[0].find(".v-list-item-title").text()).toBe('host');
    expect(listItems[0].find(".v-list-item-subtitle").text()).toBe('unix:///var/run/docker.sock');
  });

  it('toggles detail view on click', async () => {
    const wrapper = mountConfigItem({ item });

    await wrapper.find('.v-card-title').trigger('click');
    expect(wrapper.vm.showDetail).toBe(true);

    await wrapper.find('.v-card-title').trigger('click');
    expect(wrapper.vm.showDetail).toBe(false);
  });

  it('displays agent name and status when item has an agent', () => {
    item.agent = 'agent1';
    const wrapper = mountConfigItem({ item, agents });

    expect(wrapper.find('div.text-body-3').text()).toContain('agent1');
    expect(wrapper.find('.v-chip[data-testid="agent"]').attributes('color')).toBe('success');
  });

  it('displays correct color for disconnected agent', () => {
    item.agent = 'agent2';
    const wrapper = mountConfigItem({ item, agents });

    expect(wrapper.find('div.text-body-3').text()).toContain('agent2');
    expect(wrapper.find('.v-chip[data-testid="agent"]').attributes('color')).toBe('error');
  });

  it('displays "Default configuration" when no configuration items and no agent', async () => {
    item.configuration = {};
    const wrapper = mountConfigItem({ item });

    expect(wrapper.findComponent('.v-card-text').find('span').text()).toBe('Default configuration');
  });

  it('formats empty values as "<empty>"', async () => {
    item.configuration.emptyValue = null;
    item.configuration.anotherEmpty = '';
    const wrapper = mountConfigItem({ item });
    const listItems = wrapper.findAll('.v-list-item');
    expect(listItems.filter(i => i.text().includes('emptyValue'))[0].find('.v-list-item-subtitle').text()).toContain('<empty>');
    expect(listItems.filter(i => i.text().includes('anotherEmpty'))[0].find('.v-list-item-subtitle').text()).toContain('<empty>');
  });

  it('renders router-link for agent if present', async () => {
    item.agent = 'agent1';
    const wrapper = mountConfigItem({ item, agents });
    const agentListItem = wrapper.findAll('.v-list-item').filter(item => item.text().includes('Agent'))[0];
    expect(agentListItem.findComponent(RouterLinkStub).props().to).toBe('/configuration/agents');
    expect(agentListItem.findComponent(RouterLinkStub).text()).toBe('agent1');
  });
});