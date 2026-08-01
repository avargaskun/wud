import { mount } from '@vue/test-utils';
import ContainerTrigger from '@/components/ContainerTrigger';
import { runTrigger } from '@/services/container';

jest.mock('@/services/container', () => ({
  runTrigger: jest.fn()
}));

const mockTrigger = {
  id: 'docker.local',
  type: 'docker',
  name: 'local',
  agent: undefined,
  configuration: { threshold: 'all' }
};

describe('ContainerTrigger', () => {
  let wrapper;

  const mountComponent = () =>
    mount(ContainerTrigger, {
      props: {
        trigger: mockTrigger,
        updateAvailable: true,
        containerId: 'container-1'
      },
      global: {
        stubs: {
          'router-link': { template: '<a><slot /></a>' }
        }
      }
    });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('notifies success when the response carries no dependents', async () => {
    (runTrigger as jest.Mock).mockResolvedValue({});
    wrapper = mountComponent();

    await wrapper.vm.runTrigger();

    expect(runTrigger).toHaveBeenCalledWith({
      containerId: 'container-1',
      triggerType: 'docker',
      triggerName: 'local',
      triggerAgent: undefined
    });
    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Trigger executed with success'
    );
    expect(wrapper.emitted('trigger-executed')).toHaveLength(1);
  });

  it('notifies success when every dependent was bounced', async () => {
    (runTrigger as jest.Mock).mockResolvedValue({
      dependents: [
        { name: 'sidecar', host: 'main', status: 'bounced', method: 'recreate' }
      ]
    });
    wrapper = mountComponent();

    await wrapper.vm.runTrigger();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Trigger executed with success'
    );
  });

  it('warns when a dependent was not bounced', async () => {
    (runTrigger as jest.Mock).mockResolvedValue({
      dependents: [
        { name: 'x', host: 'main', status: 'skipped', reason: 'unresolved' }
      ]
    });
    wrapper = mountComponent();

    await wrapper.vm.runTrigger();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Updated; 1 dependent(s) not restarted: x',
      'warning'
    );
    expect(wrapper.emitted('trigger-executed')).toHaveLength(1);
  });

  it('lists every non-bounced dependent in the warning', async () => {
    (runTrigger as jest.Mock).mockResolvedValue({
      dependents: [
        { name: 'ok', host: 'main', status: 'bounced', method: 'restart' },
        { name: 'ghost', host: 'main', status: 'skipped', reason: 'unresolved' },
        { name: 'broken', host: 'main', status: 'failed', reason: 'boom' }
      ]
    });
    wrapper = mountComponent();

    await wrapper.vm.runTrigger();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      'Updated; 2 dependent(s) not restarted: ghost, broken',
      'warning'
    );
  });

  it('notifies an error when the trigger call rejects', async () => {
    (runTrigger as jest.Mock).mockRejectedValue(new Error('boom'));
    wrapper = mountComponent();

    await wrapper.vm.runTrigger();

    expect(wrapper.vm.$eventBus.emit).toHaveBeenCalledWith(
      'notify',
      expect.stringContaining('boom'),
      'error'
    );
    expect(wrapper.emitted('trigger-executed')).toBeUndefined();
    expect(wrapper.vm.isTriggering).toBe(false);
  });
});
