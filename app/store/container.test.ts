// @ts-nocheck
import * as container from './container';
import * as event from '../event';

jest.mock('./migrate');
jest.mock('../event');

beforeEach(async () => {
    jest.resetAllMocks();
});

test('createCollections should create collection containers when not exist', async () => {
    const db = {
        getCollection: () => null,
        addCollection: () => ({
            findOne: () => {},
            insert: () => {},
        }),
    };
    const spy = jest.spyOn(db, 'addCollection');
    container.createCollections(db);
    expect(spy).toHaveBeenCalledWith('containers');
});

test('createCollections should not create collection containers when already exist', async () => {
    const db = {
        getCollection: () => ({
            findOne: () => {},
            insert: () => {},
        }),
        addCollection: () => null,
    };
    const spy = jest.spyOn(db, 'addCollection');
    container.createCollections(db);
    expect(spy).not.toHaveBeenCalled();
});

test('insertContainer should insert doc and emit an event', async () => {
    const collection = {
        findOne: () => {},
        insert: () => {},
    };
    const db = {
        getCollection: () => collection,
        addCollection: () => null,
    };
    const containerToSave = {
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
    };
    const spyInsert = jest.spyOn(collection, 'insert');
    const spyEvent = jest.spyOn(event, 'emitContainerAdded');
    container.createCollections(db);
    container.insertContainer(containerToSave);
    expect(spyInsert).toHaveBeenCalled();
    expect(spyEvent).toHaveBeenCalled();
});

test('updateContainer should update doc and emit an event', async () => {
    const collection = {
        insert: () => {},
        chain: () => ({
            find: () => ({
                remove: () => ({}),
            }),
        }),
    };
    const db = {
        getCollection: () => collection,
        addCollection: () => null,
    };
    const containerToSave = {
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
    };
    const spyInsert = jest.spyOn(collection, 'insert');
    const spyEvent = jest.spyOn(event, 'emitContainerUpdated');
    container.createCollections(db);
    container.updateContainer(containerToSave);
    expect(spyInsert).toHaveBeenCalled();
    expect(spyEvent).toHaveBeenCalled();
});

test('insertContainer and updateContainer should never persist selectedUpdate', async () => {
    const collection = {
        findOne: () => {},
        insert: () => {},
        chain: () => ({
            find: () => ({
                remove: () => ({}),
            }),
        }),
    };
    const db = {
        getCollection: () => collection,
        addCollection: () => null,
    };
    const containerToSave = {
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
                value: '1.0.0',
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
            tag: '1.0.1',
        },
        updates: {
            patch: {
                kind: 'tag',
                localValue: '1.0.0',
                remoteValue: '1.0.1',
                semverDiff: 'patch',
            },
        },
        selectedUpdate: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '1.0.1',
            semverDiff: 'patch',
        },
    };
    const spyInsert = jest.spyOn(collection, 'insert');
    container.createCollections(db);

    const inserted = container.insertContainer({ ...containerToSave });
    expect('selectedUpdate' in inserted).toBe(false);
    expect('selectedUpdate' in spyInsert.mock.calls[0][0].data).toBe(false);
    expect(inserted.updates).toEqual(containerToSave.updates);

    const updated = container.updateContainer({ ...containerToSave });
    expect('selectedUpdate' in updated).toBe(false);
    expect('selectedUpdate' in spyInsert.mock.calls[1][0].data).toBe(false);
    expect(updated.updates).toEqual(containerToSave.updates);
});

test('getContainers should return all containers sorted by name', async () => {
    const containerExample = {
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
    };
    const containers = [
        {
            data: {
                ...containerExample,
                name: 'container3',
            },
        },
        {
            data: {
                ...containerExample,
                name: 'container2',
            },
        },
        {
            data: {
                ...containerExample,
                name: 'container1',
            },
        },
    ];
    const collection = {
        find: () => containers,
    };
    const db = {
        getCollection: () => collection,
        addCollection: () => ({
            findOne: () => {},
            insert: () => {},
        }),
    };
    container.createCollections(db);
    const results = container.getContainers();
    expect(results[0].name).toEqual('container1');
    expect(results[1].name).toEqual('container2');
    expect(results[2].name).toEqual('container3');
});

test('getContainer should return 1 container by id', async () => {
    const containerExample = {
        data: {
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
    };
    const collection = {
        findOne: () => containerExample,
    };
    const db = {
        getCollection: () => collection,
    };
    container.createCollections(db);
    const result = container.getContainer('132456789');
    expect(result.name).toEqual(containerExample.data.name);
});

test('getContainer should return undefined when not found', async () => {
    const collection = {
        findOne: () => null,
    };
    const db = {
        getCollection: () => collection,
    };
    container.createCollections(db);
    const result = container.getContainer('123456789');
    expect(result).toEqual(undefined);
});

test('deleteContainer should delete doc and emit an event', async () => {
    const containerExample = {
        data: {
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
    };
    const collection = {
        findOne: () => containerExample,
        chain: () => ({
            find: () => ({
                remove: () => ({}),
            }),
        }),
    };
    const db = {
        getCollection: () => collection,
        addCollection: () => null,
    };
    const spyEvent = jest.spyOn(event, 'emitContainerRemoved');
    container.createCollections(db);
    container.deleteContainer(containerExample);
    expect(spyEvent).toHaveBeenCalled();
});
