import { mount, RouterLinkStub } from '@vue/test-utils';
import ContainerDetail from '@/components/ContainerDetail';

const mockContainer = {
  id: 'test-container-id',
  name: 'test-container',
  status: 'running',
  watcher: 'local',
  image: {
    registry: { name: 'hub' },
    tag: { value: '2.36.0', semver: true }
  }
};

function mountDetail(container) {
  return mount(ContainerDetail, {
    props: { container },
    global: {
      stubs: {
        RouterLink: RouterLinkStub
      }
    }
  });
}

describe('ContainerDetail', () => {
  let wrapper;

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it('does not render the version ceiling when the container has none', () => {
    wrapper = mountDetail(mockContainer);
    expect(wrapper.text()).not.toContain('Version ceiling');
  });

  it('renders a static version ceiling', () => {
    wrapper = mountDetail({
      ...mockContainer,
      ceiling: { version: '2.37.9' }
    });
    expect(wrapper.text()).toContain('Version ceiling');
    expect(wrapper.text()).toContain('2.37.9');
    expect(wrapper.text()).not.toContain('(from :');
  });

  it('renders a dynamic version ceiling with the tag it came from', () => {
    wrapper = mountDetail({
      ...mockContainer,
      ceiling: { tag: 'stable', version: '2.37.9' }
    });
    expect(wrapper.text()).toContain('2.37.9 (from :stable)');
  });
});
