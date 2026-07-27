// @ts-nocheck
jest.mock('../store/container');
jest.mock('../log');
jest.mock('../event', () => ({
    registerContainerAdded: jest.fn(),
    registerContainerUpdated: jest.fn(),
    registerContainerRemoved: jest.fn(),
}));

import * as store from '../store/container';
import * as event from '../event';
import * as container from './container';
import log from '../log';

const sampleContainers = [
    {
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'registry',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: 'version',
                semver: false,
            },
            digest: {
                watch: false,
                repo: undefined,
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: 'version',
        },
    },
];

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    store.getContainers = jest.fn(() => sampleContainers);
});

afterEach(() => {
    jest.useRealTimers();
});

test('gauge must be populated on init when containers are in the store', async () => {
    let onAdded;
    event.registerContainerAdded.mockImplementation((handler) => {
        onAdded = handler;
        return jest.fn();
    });
    event.registerContainerUpdated.mockImplementation(() => jest.fn());
    event.registerContainerRemoved.mockImplementation(() => jest.fn());

    const gauge = container.init();
    const spySet = jest.spyOn(gauge, 'set');
    spySet.mockClear();

    onAdded(sampleContainers[0]);
    jest.advanceTimersByTime(5000);

    expect(spySet).toHaveBeenCalledWith(
        {
            id: 'container-123456789',
            image_architecture: 'arch',
            image_created: '2021-06-12T05:33:38.440Z',
            image_digest_repo: undefined,
            image_digest_watch: false,
            image_id: 'image-123456789',
            image_name: 'organization/image',
            image_os: 'os',
            image_registry_name: 'registry',
            image_registry_url: 'https://hub',
            image_tag_semver: false,
            image_tag_value: 'version',
            name: 'test',
            result_tag: 'version',
            watcher: 'test',
        },
        1,
    );
});

test("gauge must warn when data don't match expected labels", async () => {
    event.registerContainerAdded.mockImplementation(() => jest.fn());
    event.registerContainerUpdated.mockImplementation(() => jest.fn());
    event.registerContainerRemoved.mockImplementation(() => jest.fn());
    store.getContainers = jest.fn(() => [
        {
            extra: 'extra',
        },
    ]);
    const spyLog = jest.spyOn(log, 'warn');
    container.init();
    expect(spyLog).toHaveBeenCalled();
});

const bucketContainer = {
    id: 'container-987654321',
    name: 'test-buckets',
    watcher: 'test',
    image: {
        id: 'image-987654321',
        registry: {
            name: 'registry',
            url: 'https://hub',
        },
        name: 'organization/image',
        tag: {
            value: '1.2',
            semver: true,
        },
        digest: {
            watch: false,
            repo: undefined,
        },
        architecture: 'arch',
        os: 'os',
        created: '2021-06-12T05:33:38.440Z',
    },
    result: {
        tag: '2.0',
    },
    updateAvailable: true,
    updateKind: {
        kind: 'tag',
        localValue: '1.2',
        remoteValue: '2.0',
        semverDiff: 'major',
    },
    // major populated, minor explicitly null, patch and digest absent
    updates: {
        major: {
            kind: 'tag',
            localValue: '1.2',
            remoteValue: '2.0',
            semverDiff: 'major',
            link: 'https://example.com/2.0',
        },
        minor: null,
    },
};

test('gauge must accept a container carrying populated, null and absent update buckets', async () => {
    let onAdded;
    event.registerContainerAdded.mockImplementation((handler) => {
        onAdded = handler;
        return jest.fn();
    });
    event.registerContainerUpdated.mockImplementation(() => jest.fn());
    event.registerContainerRemoved.mockImplementation(() => jest.fn());
    store.getContainers = jest.fn(() => [bucketContainer]);
    const spyLog = jest.spyOn(log, 'warn');

    const gauge = container.init();
    const spySet = jest.spyOn(gauge, 'set');
    spySet.mockClear();

    onAdded(bucketContainer);
    jest.advanceTimersByTime(5000);

    expect(spyLog).not.toHaveBeenCalled();
    expect(spySet).toHaveBeenCalledWith(
        {
            id: 'container-987654321',
            image_architecture: 'arch',
            image_created: '2021-06-12T05:33:38.440Z',
            image_digest_repo: undefined,
            image_digest_watch: false,
            image_id: 'image-987654321',
            image_name: 'organization/image',
            image_os: 'os',
            image_registry_name: 'registry',
            image_registry_url: 'https://hub',
            image_tag_semver: true,
            image_tag_value: '1.2',
            name: 'test-buckets',
            result_tag: '2.0',
            update_available: true,
            update_kind_kind: 'tag',
            update_kind_local_value: '1.2',
            update_kind_remote_value: '2.0',
            update_kind_semver_diff: 'major',
            updates_major_kind: 'tag',
            updates_major_link: 'https://example.com/2.0',
            updates_major_local_value: '1.2',
            updates_major_remote_value: '2.0',
            updates_major_semver_diff: 'major',
            watcher: 'test',
        },
        1,
    );

    const labels = spySet.mock.calls[0][0];
    expect('updates_minor' in labels).toBe(false);
    expect('updates_patch' in labels).toBe(false);
    expect('updates_digest' in labels).toBe(false);
    expect('updates' in labels).toBe(false);
});

test('gauge must accept a container whose updates object is empty', async () => {
    let onAdded;
    event.registerContainerAdded.mockImplementation((handler) => {
        onAdded = handler;
        return jest.fn();
    });
    event.registerContainerUpdated.mockImplementation(() => jest.fn());
    event.registerContainerRemoved.mockImplementation(() => jest.fn());
    const emptyUpdatesContainer = { ...sampleContainers[0], updates: {} };
    store.getContainers = jest.fn(() => [emptyUpdatesContainer]);
    const spyLog = jest.spyOn(log, 'warn');

    const gauge = container.init();
    const spySet = jest.spyOn(gauge, 'set');
    spySet.mockClear();

    onAdded(emptyUpdatesContainer);
    jest.advanceTimersByTime(5000);

    expect(spyLog).not.toHaveBeenCalled();
    expect(spySet).toHaveBeenCalledTimes(1);
    expect('updates' in spySet.mock.calls[0][0]).toBe(false);
    expect(spySet.mock.calls[0][0].id).toEqual('container-123456789');
});

test('interval tick should skip full rebuild when metrics are clean', async () => {
    event.registerContainerAdded.mockImplementation(() => jest.fn());
    event.registerContainerUpdated.mockImplementation(() => jest.fn());
    event.registerContainerRemoved.mockImplementation(() => jest.fn());

    const gauge = container.init();
    const spyReset = jest.spyOn(gauge, 'reset');
    const spySet = jest.spyOn(gauge, 'set');

    spyReset.mockClear();
    spySet.mockClear();
    jest.advanceTimersByTime(5000);

    expect(spyReset).not.toHaveBeenCalled();
    expect(spySet).not.toHaveBeenCalled();
});

test('container event should mark metrics dirty and rebuild on next interval', async () => {
    let onAdded;
    event.registerContainerAdded.mockImplementation((handler) => {
        onAdded = handler;
        return jest.fn();
    });
    event.registerContainerUpdated.mockImplementation(() => jest.fn());
    event.registerContainerRemoved.mockImplementation(() => jest.fn());

    const gauge = container.init();
    const spySet = jest.spyOn(gauge, 'set');
    spySet.mockClear();

    onAdded(sampleContainers[0]);
    jest.advanceTimersByTime(5000);

    expect(spySet).toHaveBeenCalledTimes(1);
});
