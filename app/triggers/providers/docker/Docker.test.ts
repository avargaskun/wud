// @ts-nocheck
import { ValidationError } from 'joi';
import Docker from './Docker';
import { ContainerGoneError } from './errors';
import log from '../../../log';

const configurationValid = {
    prune: false,
    dryrun: false,
    multinetworkfallback: true,
    threshold: 'all',
    mode: 'simple',
    once: true,
    auto: true,
    autoremovetimeout: 10000,
    postupdatetimeout: 300000,
    simpletitle:
        'New ${container.updateKind.kind} found for container ${container.name}',
    simplebody:
        'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
    batchtitle: '${containers.length} updates available',
};

const docker = new Docker();
docker.configuration = configurationValid;
docker.log = log;

jest.mock('../../../registry', () => ({
    getState() {
        return {
            watcher: {
                'docker.test': {
                    getId: () => 'docker.test',
                    watch: () => Promise.resolve(),
                    dockerApi: {
                        getContainer: (id) => {
                            if (id === '123456789') {
                                return Promise.resolve({
                                    inspect: () =>
                                        Promise.resolve({
                                            Name: '/container-name',
                                            Id: '123456798',
                                            State: {
                                                Running: true,
                                            },
                                            NetworkSettings: {
                                                Networks: {
                                                    test: {
                                                        Aliases: [
                                                            '9708fc7b44f2',
                                                            'test',
                                                        ],
                                                    },
                                                },
                                            },
                                        }),
                                    stop: () => Promise.resolve(),
                                    remove: () => Promise.resolve(),
                                    start: () => Promise.resolve(),
                                });
                            }
                            return Promise.reject(
                                new Error('Error when getting container'),
                            );
                        },
                        createContainer: (container) => {
                            if (container._query?.name === 'container-name') {
                                return Promise.resolve({
                                    id: 'new-container-id',
                                    start: () => Promise.resolve(),
                                });
                            }
                            return Promise.reject(
                                new Error('Error when creating container'),
                            );
                        },
                        pull: (image) => {
                            if (
                                image === 'test/test:1.2.3' ||
                                image === 'my-registry/test/test:4.5.6'
                            ) {
                                return Promise.resolve();
                            }
                            return Promise.reject(
                                new Error('Error when pulling image'),
                            );
                        },
                        getImage: (image) =>
                            Promise.resolve({
                                remove: () => {
                                    if (image === 'test/test:1.2.3') {
                                        return Promise.resolve();
                                    }
                                    return Promise.reject(
                                        new Error('Error when removing image'),
                                    );
                                },
                            }),
                        modem: {
                            followProgress: (pullStream, res) => res(),
                        },
                        getNetwork: () => ({
                            connect: () => Promise.resolve(),
                        }),
                    },
                },
            },
            registry: {
                hub: {
                    getAuthPull: async () => undefined,
                    getImageFullName: (image, tagOrDigest) =>
                        `${image.registry.url}/${image.name}:${tagOrDigest}`,
                },
            },
        };
    },
}));

beforeEach(async () => {
    jest.resetAllMocks();
});

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        docker.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should default postupdatetimeout to 300000', async () => {
    const { postupdatetimeout, ...withoutPostupdateTimeout } =
        configurationValid;
    expect(postupdatetimeout).toEqual(300000);
    expect(
        docker.validateConfiguration(withoutPostupdateTimeout)
            .postupdatetimeout,
    ).toEqual(300000);
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {
        url: 'git://xxx.com',
    };
    expect(() => {
        docker.validateConfiguration(configuration);
    }).toThrowError(ValidationError);
});

test('getWatcher should return watcher responsible for a container', async () => {
    expect(
        docker
            .getWatcher({
                watcher: 'test',
            })
            .getId(),
    ).toEqual('docker.test');
});

test('getCurrentContainer should return container from dockerApi', async () => {
    await expect(
        docker.getCurrentContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                id: '123456789',
            },
        ),
    ).resolves.not.toBeUndefined();
});

test('getCurrentContainer should throw error when error occurs', async () => {
    await expect(
        docker.getCurrentContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                id: 'unknown',
            },
        ),
    ).rejects.toThrowError('Error when getting container');
});

test('inspectContainer should return container details from dockerApi', async () => {
    await expect(
        docker.inspectContainer(
            {
                inspect: () => Promise.resolve({}),
            },
            log,
        ),
    ).resolves.toEqual({});
});

test('inspectContainer should throw error when error occurs', async () => {
    await expect(
        docker.inspectContainer(
            {
                inspect: () => Promise.reject(new Error('No container')),
            },
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('stopContainer should stop container from dockerApi', async () => {
    await expect(
        docker.stopContainer(
            {
                stop: () => Promise.resolve(),
            },
            'name',
            'id',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('stopContainer should throw error when error occurs', async () => {
    await expect(
        docker.stopContainer(
            {
                stop: () => Promise.reject(new Error('No container')),
            },
            'name',
            'id',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('removeContainer should stop container from dockerApi', async () => {
    await expect(
        docker.removeContainer(
            {
                remove: () => Promise.resolve(),
            },
            'name',
            'id',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('removeContainer should throw error when error occurs', async () => {
    await expect(
        docker.removeContainer(
            {
                remove: () => Promise.reject(new Error('No container')),
            },
            'name',
            'id',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('waitContainerRemoved should wait for the container to be removed from dockerApi', async () => {
    await expect(
        docker.waitContainerRemoved(
            {
                wait: () => Promise.resolve(),
            },
            'name',
            'id',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('waitContainerRemoved should throw error when error occurs', async () => {
    await expect(
        docker.waitContainerRemoved(
            {
                wait: () => Promise.reject(new Error('No container')),
            },
            'name',
            'id',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('startContainer should stop container from dockerApi', async () => {
    await expect(
        docker.startContainer(
            {
                start: () => Promise.resolve(),
            },
            'name',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('startContainer should throw error when error occurs', async () => {
    await expect(
        docker.startContainer(
            {
                start: () => Promise.reject(new Error('No container')),
            },
            'name',
            log,
        ),
    ).rejects.toThrowError('No container');
});

test('createContainer should stop container from dockerApi', async () => {
    await expect(
        docker.createContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                name: 'container-name',
            },
            'name',
            log,
        ),
    ).resolves.not.toBeUndefined();
});

test('createContainer should throw error when error occurs', async () => {
    await expect(
        docker.createContainer(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            {
                name: 'ko',
            },
            'name',
            log,
        ),
    ).rejects.toThrowError('Error when creating container');
});

test('pull should pull image from dockerApi', async () => {
    await expect(
        docker.pullImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            undefined,
            'test/test:1.2.3',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('pull should throw error when error occurs', async () => {
    await expect(
        docker.pullImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            undefined,
            'test/test:unknown',
            log,
        ),
    ).rejects.toThrowError('Error when pulling image');
});

test('removeImage should pull image from dockerApi', async () => {
    await expect(
        docker.removeImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            'test/test:1.2.3',
            log,
        ),
    ).resolves.toBeUndefined();
});

test('removeImage should throw error when error occurs', async () => {
    await expect(
        docker.removeImage(
            docker.getWatcher({ watcher: 'test' }).dockerApi,
            'test/test:unknown',
            log,
        ),
    ).rejects.toThrowError('Error when removing image');
});

test('clone should clone an existing container spec', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789',
            HostConfig: {
                a: 'a',
                b: 'b',
            },
            Config: {
                configA: 'a',
                configB: 'b',
            },
            NetworkSettings: {
                Networks: {
                    test: {
                        Aliases: ['9708fc7b44f2', 'test'],
                    },
                },
            },
        },
        'test/test:2.0.0',
    );
    expect(clone).toEqual({
        HostConfig: {
            a: 'a',
            b: 'b',
        },
        Image: 'test/test:2.0.0',
        configA: 'a',
        configB: 'b',
        name: 'test',
        NetworkingConfig: {
            EndpointsConfig: {
                test: {
                    Aliases: ['9708fc7b44f2', 'test'],
                },
            },
        },
    });
});

test('clone should remove hostname and exposed ports when network mode is container:*', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789',
            HostConfig: {
                NetworkMode: 'container:sidecar',
            },
            Config: {
                Hostname: 'test-host',
                ExposedPorts: {
                    '8080/tcp': {},
                },
                configA: 'a',
            },
            NetworkSettings: {
                Networks: {
                    default: {},
                },
            },
        },
        'test/test:2.0.0',
    );
    expect(clone.Hostname).toBeUndefined();
    expect(clone.ExposedPorts).toBeUndefined();
    expect(clone.HostConfig.NetworkMode).toEqual('container:sidecar');
});

const happyContainer = {
    watcher: 'test',
    id: '123456789',
    name: 'container-name',
    Name: '/container-name',
    image: {
        name: 'test/test',
        registry: {
            name: 'hub',
            url: 'my-registry',
        },
    },
    updateKind: {
        remoteValue: '4.5.6',
    },
};

test('trigger should not throw when all is ok', async () => {
    await expect(docker.trigger(happyContainer)).resolves.toEqual({
        members: [
            { id: '123456789', name: 'container-name', status: 'updated' },
        ],
        dependents: [],
    });
});

test('pullContainer should return an update context on the happy path', async () => {
    const ctx = await docker.pullContainer(happyContainer);
    expect(ctx).toBeDefined();
    expect(ctx.newImage).toBe('my-registry/test/test:4.5.6');
    expect(ctx.currentContainerSpec).toBeDefined();
    expect(ctx.state).toEqual({ Running: true });
});

test('pullContainer should return undefined and warn when the container does not exist', async () => {
    const warn = jest.fn();
    const fakeLogger = {
        warn,
        info: jest.fn(),
        debug: jest.fn(),
        child: () => fakeLogger,
    };
    jest.spyOn(docker.log, 'child').mockReturnValue(fakeLogger);
    jest.spyOn(docker, 'getCurrentContainer').mockResolvedValue(undefined);
    const result = await docker.pullContainer(happyContainer);
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
        'Unable to update the container because it does not exist',
    );
    jest.restoreAllMocks();
});

test('pullContainer should reject when the image pull fails', async () => {
    await expect(
        docker.pullContainer({
            watcher: 'test',
            id: '123456789',
            Name: '/container-name',
            image: {
                name: 'test/test',
                registry: {
                    name: 'hub',
                    url: 'my-registry',
                },
            },
            updateKind: {
                remoteValue: 'unknown',
            },
        }),
    ).rejects.toThrowError('Error when pulling image');
});

test('swapContainer should run stop, remove, create and start on the happy path', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const wait = jest.fn().mockResolvedValue(undefined);
    const newStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockResolvedValue({ id: 'new-container-id', start: newStart }),
    };
    const ctx = {
        dockerApi,
        registry: {
            getImageFullName: () => 'my-registry/test/test:1.2.3',
        },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: { stop, remove, wait },
        currentContainerSpec: {
            Name: '/container-name',
            Id: '123456789',
            Config: {},
            HostConfig: {},
            NetworkSettings: { Networks: {} },
            State: { Running: true },
        },
        state: { Running: true },
    };
    const container = { name: 'container-name', id: '123456789' };
    await expect(docker.swapContainer(container, ctx)).resolves.toEqual({
        container,
        success: true,
        newContainerId: 'new-container-id',
        startedAfterSwap: true,
        oldContainerId: '123456789',
    });
    expect(stop).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(dockerApi.createContainer).toHaveBeenCalled();
    expect(newStart).toHaveBeenCalled();
});

test('swapContainer should wait for auto-removal when HostConfig.AutoRemove is true', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const wait = jest.fn().mockResolvedValue(undefined);
    const newStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({ start: newStart }),
    };
    const ctx = {
        dockerApi,
        registry: {
            getImageFullName: () => 'my-registry/test/test:1.2.3',
        },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: { stop, remove, wait },
        currentContainerSpec: {
            Name: '/container-name',
            Id: '123456789',
            Config: {},
            HostConfig: { AutoRemove: true },
            NetworkSettings: { Networks: {} },
            State: { Running: true },
        },
        state: { Running: true },
    };
    await expect(
        docker.swapContainer({ name: 'container-name', id: '123456789' }, ctx),
    ).resolves.toMatchObject({
        success: true,
        startedAfterSwap: true,
        oldContainerId: '123456789',
    });
    expect(stop).toHaveBeenCalled();
    expect(wait).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(newStart).toHaveBeenCalled();
});

test('trigger should skip swap when dry-run mode is enabled', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    const swapSpy = jest.spyOn(docker, 'swapContainer');
    await expect(docker.trigger(happyContainer)).resolves.toBeUndefined();
    expect(swapSpy).not.toHaveBeenCalled();
    docker.configuration = configurationValid;
    jest.restoreAllMocks();
});

const buildSwapMock = (container) => ({
    container,
    success: true,
    newContainerId: `new-${container.id}`,
    startedAfterSwap: true,
    oldContainerId: container.id,
});

test('triggerBatch should pull every container before swapping any (lockstep)', async () => {
    const order = [];
    jest.spyOn(docker, 'pullContainer').mockImplementation(async () => {
        order.push('pull');
        return {};
    });
    jest.spyOn(docker, 'swapContainer').mockImplementation(async (c) => {
        order.push('swap');
        return buildSwapMock(c);
    });
    await docker.triggerBatch([
        { id: 'a', name: 'a', watcher: 'test' },
        { id: 'b', name: 'b', watcher: 'test' },
    ]);
    expect(order).toEqual(['pull', 'pull', 'swap', 'swap']);
    jest.restoreAllMocks();
});

test('triggerBatch should not swap any container when a pull rejects', async () => {
    jest.spyOn(docker, 'pullContainer').mockImplementation(async (c) => {
        if (c.id === 'bad') {
            throw new Error('pull failed');
        }
        return {};
    });
    const swapSpy = jest
        .spyOn(docker, 'swapContainer')
        .mockImplementation(async (c) => buildSwapMock(c));
    await expect(
        docker.triggerBatch([
            { id: 'good', name: 'good', watcher: 'test' },
            { id: 'bad', name: 'bad', watcher: 'test' },
        ]),
    ).rejects.toThrowError('pull failed');
    expect(swapSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

test('triggerBatch should pull all but swap none under dry-run', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    const pullSpy = jest.spyOn(docker, 'pullContainer').mockResolvedValue({});
    const swapSpy = jest
        .spyOn(docker, 'swapContainer')
        .mockImplementation(async (c) => buildSwapMock(c));
    const postUpdateSpy = jest.spyOn(docker, 'runPostUpdate');
    await expect(
        docker.triggerBatch([
            { id: 'a', name: 'a', watcher: 'test' },
            { id: 'b', name: 'b', watcher: 'test' },
        ]),
    ).resolves.toBeUndefined();
    expect(pullSpy).toHaveBeenCalledTimes(2);
    expect(swapSpy).not.toHaveBeenCalled();
    expect(postUpdateSpy).not.toHaveBeenCalled();
    docker.configuration = configurationValid;
    jest.restoreAllMocks();
});

test('triggerBatch should swap only the containers whose pull returned a context', async () => {
    jest.spyOn(docker, 'pullContainer').mockImplementation(async (c) =>
        c.id === 'gone' ? undefined : { id: c.id },
    );
    const swapSpy = jest
        .spyOn(docker, 'swapContainer')
        .mockImplementation(async (c) => buildSwapMock(c));
    const result = await docker.triggerBatch([
        { id: 'gone', name: 'gone', watcher: 'test' },
        { id: 'live', name: 'live', watcher: 'test' },
    ]);
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy.mock.calls[0][0]).toEqual({
        id: 'live',
        name: 'live',
        watcher: 'test',
    });
    expect(result.members).toEqual([
        {
            id: 'gone',
            name: 'gone',
            status: 'failed',
            error: 'Container gone no longer exists',
            gone: true,
        },
        { id: 'live', name: 'live', status: 'updated' },
    ]);
    jest.restoreAllMocks();
});

test('swapContainer should skip stop and start when the container is not running', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const newStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({ start: newStart }),
    };
    const ctx = {
        dockerApi,
        registry: { getImageFullName: () => 'my-registry/test/test:1.2.3' },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: { stop, remove },
        currentContainerSpec: {
            Name: '/container-name',
            Id: '123456789',
            Config: {},
            HostConfig: {},
            NetworkSettings: { Networks: {} },
            State: { Running: false },
        },
        state: { Running: false },
    };
    await expect(
        docker.swapContainer({ name: 'container-name', id: '123456789' }, ctx),
    ).resolves.toMatchObject({
        success: true,
        startedAfterSwap: false,
        oldContainerId: '123456789',
    });
    expect(stop).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(dockerApi.createContainer).toHaveBeenCalled();
    expect(newStart).not.toHaveBeenCalled();
});

test('swapContainer should remove the previous image when prune is enabled', async () => {
    docker.configuration = { ...configurationValid, prune: true };
    const removeImage = jest.fn().mockResolvedValue(undefined);
    const newStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({ start: newStart }),
        getImage: jest.fn().mockResolvedValue({ remove: removeImage }),
    };
    const ctx = {
        dockerApi,
        registry: {
            getImageFullName: (image, tagOrDigest) =>
                `my-registry/${image.name}:${tagOrDigest}`,
        },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
        },
        currentContainerSpec: {
            Name: '/container-name',
            Id: '123456789',
            Config: {},
            HostConfig: {},
            NetworkSettings: { Networks: {} },
            State: { Running: true },
        },
        state: { Running: true },
    };
    const container = {
        name: 'container-name',
        id: '123456789',
        image: { name: 'test/test', tag: { value: '1.2.3' } },
        updateKind: { kind: 'tag' },
    };
    await expect(docker.swapContainer(container, ctx)).resolves.toMatchObject({
        success: true,
        startedAfterSwap: true,
    });
    expect(dockerApi.getImage).toHaveBeenCalledWith(
        'my-registry/test/test:1.2.3',
    );
    expect(removeImage).toHaveBeenCalled();
    docker.configuration = configurationValid;
});

test('getNewImageFullName should keep the current tag when updateKind is digest', () => {
    const registryMock = {
        getImageFullName: (image, tagOrDigest) =>
            `${image.registry.url}/${image.name}:${tagOrDigest}`,
    };
    const container = {
        image: {
            name: 'test/test',
            registry: { url: 'my-registry' },
            tag: { value: '1.2.3' },
        },
        updateKind: { kind: 'digest', remoteValue: 'sha256:abc' },
    };
    expect(docker.getNewImageFullName(registryMock, container)).toBe(
        'my-registry/test/test:1.2.3',
    );
});

test('trigger should not use fallback when multi-network create succeeds', async () => {
    const createContainer = jest.fn(() =>
        Promise.resolve({
            id: 'created-id',
            start: () => Promise.resolve(),
        }),
    );
    const getNetwork = jest.fn(() => ({
        connect: jest.fn(() => Promise.resolve()),
    }));
    const dockerApi = {
        createContainer,
        getNetwork,
        pull: () => Promise.resolve(),
        modem: {
            followProgress: (pullStream, res) => res(),
        },
        getContainer: () =>
            Promise.resolve({
                inspect: () =>
                    Promise.resolve({
                        Name: '/container-name',
                        Id: '123456798',
                        State: {
                            Running: false,
                        },
                        HostConfig: {
                            NetworkMode: 'postgres_default',
                        },
                        NetworkSettings: {
                            Networks: {
                                cloud_default: {
                                    Aliases: ['cloud'],
                                },
                                postgres_default: {
                                    Aliases: ['postgres'],
                                },
                            },
                        },
                    }),
                stop: () => Promise.resolve(),
                remove: () => Promise.resolve(),
                start: () => Promise.resolve(),
            }),
    };
    const watcherSpy = jest.spyOn(docker, 'getWatcher').mockReturnValue({
        dockerApi,
    });

    await expect(
        docker.trigger({
            watcher: 'test',
            id: '123456789',
            name: 'container-name',
            image: {
                name: 'test/test',
                registry: {
                    name: 'hub',
                    url: 'my-registry',
                },
            },
            updateKind: {
                remoteValue: '4.5.6',
            },
        }),
    ).resolves.toEqual({
        members: [
            { id: '123456789', name: 'container-name', status: 'updated' },
        ],
        dependents: [],
    });

    watcherSpy.mockRestore();

    expect(createContainer).toHaveBeenCalledTimes(1);
    expect(getNetwork).not.toHaveBeenCalled();
});

test('trigger should fallback to primary then connect secondary networks', async () => {
    const createContainer = jest
        .fn()
        .mockRejectedValueOnce(
            new Error(
                'Container cannot be connected to network endpoints: cloud_default, postgres_default, valkey_default',
            ),
        )
        .mockResolvedValueOnce({
            id: 'created-id',
            start: () => Promise.resolve(),
        });
    const connectCalls = [];
    const getNetwork = jest.fn((networkName) => ({
        connect: (payload) => {
            connectCalls.push({
                networkName,
                payload,
            });
            return Promise.resolve();
        },
    }));
    const dockerApi = {
        createContainer,
        getNetwork,
        pull: () => Promise.resolve(),
        modem: {
            followProgress: (pullStream, res) => res(),
        },
        getContainer: () =>
            Promise.resolve({
                inspect: () =>
                    Promise.resolve({
                        Name: '/container-name',
                        Id: '123456798',
                        State: {
                            Running: false,
                        },
                        HostConfig: {
                            NetworkMode: 'postgres_default',
                        },
                        NetworkSettings: {
                            Networks: {
                                cloud_default: {
                                    Aliases: ['123456798abc', 'cloud'],
                                },
                                postgres_default: {
                                    Aliases: ['postgres'],
                                },
                                valkey_default: {
                                    Aliases: ['valkey'],
                                },
                            },
                        },
                    }),
                stop: () => Promise.resolve(),
                remove: () => Promise.resolve(),
                start: () => Promise.resolve(),
            }),
    };
    const watcherSpy = jest.spyOn(docker, 'getWatcher').mockReturnValue({
        dockerApi,
    });

    await expect(
        docker.trigger({
            watcher: 'test',
            id: '123456789',
            name: 'container-name',
            image: {
                name: 'test/test',
                registry: {
                    name: 'hub',
                    url: 'my-registry',
                },
            },
            updateKind: {
                remoteValue: '4.5.6',
            },
        }),
    ).resolves.toEqual({
        members: [
            { id: '123456789', name: 'container-name', status: 'updated' },
        ],
        dependents: [],
    });

    watcherSpy.mockRestore();

    expect(createContainer).toHaveBeenCalledTimes(2);
    expect(
        Object.keys(
            createContainer.mock.calls[1][0]._body.NetworkingConfig
                .EndpointsConfig,
        ),
    ).toEqual(['postgres_default']);
    expect(getNetwork).toHaveBeenCalledTimes(2);
    expect(connectCalls.map((call) => call.networkName)).toEqual([
        'cloud_default',
        'valkey_default',
    ]);
    expect(connectCalls[0].payload.EndpointConfig.Aliases).toEqual(['cloud']);
});

test('trigger should throw when fallback cannot connect a secondary network', async () => {
    const createContainer = jest
        .fn()
        .mockRejectedValueOnce(
            new Error(
                'Container cannot be connected to network endpoints: cloud_default, postgres_default, valkey_default',
            ),
        )
        .mockResolvedValueOnce({
            id: 'created-id',
            start: () => Promise.resolve(),
        });
    const getNetwork = jest.fn((networkName) => ({
        connect: () =>
            networkName === 'valkey_default'
                ? Promise.reject(new Error('connect failed'))
                : Promise.resolve(),
    }));
    const dockerApi = {
        createContainer,
        getNetwork,
        pull: () => Promise.resolve(),
        modem: {
            followProgress: (pullStream, res) => res(),
        },
        getContainer: () =>
            Promise.resolve({
                inspect: () =>
                    Promise.resolve({
                        Name: '/container-name',
                        Id: '123456798',
                        State: {
                            Running: false,
                        },
                        HostConfig: {
                            NetworkMode: 'postgres_default',
                        },
                        NetworkSettings: {
                            Networks: {
                                cloud_default: {
                                    Aliases: ['cloud'],
                                },
                                postgres_default: {
                                    Aliases: ['postgres'],
                                },
                                valkey_default: {
                                    Aliases: ['valkey'],
                                },
                            },
                        },
                    }),
                stop: () => Promise.resolve(),
                remove: () => Promise.resolve(),
                start: () => Promise.resolve(),
            }),
    };
    const watcherSpy = jest.spyOn(docker, 'getWatcher').mockReturnValue({
        dockerApi,
    });

    await expect(
        docker.trigger({
            watcher: 'test',
            id: '123456789',
            name: 'container-name',
            image: {
                name: 'test/test',
                registry: {
                    name: 'hub',
                    url: 'my-registry',
                },
            },
            updateKind: {
                remoteValue: '4.5.6',
            },
        }),
    ).rejects.toThrow('connect failed');

    watcherSpy.mockRestore();
});

const buildLogger = () => {
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
    };
    logger.child = () => logger;
    return logger;
};

test('createContainer should send the spec in the body and only the name in the query', async () => {
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({ id: 'x' }),
    };
    const spec = {
        name: 'container-name',
        Image: 'test/test:1.2.3',
        Env: ['FOO=bar'],
        Labels: { 'wud.watch': 'true' },
        HostConfig: { NetworkMode: 'bridge' },
        NetworkingConfig: { EndpointsConfig: { test: { Aliases: ['test'] } } },
    };

    await docker.createContainer(
        dockerApi,
        spec,
        'container-name',
        buildLogger(),
    );

    expect(dockerApi.createContainer).toHaveBeenCalledTimes(1);
    const payload = dockerApi.createContainer.mock.calls[0][0];
    expect(payload).toEqual({
        _query: { name: 'container-name' },
        _body: {
            Image: 'test/test:1.2.3',
            Env: ['FOO=bar'],
            Labels: { 'wud.watch': 'true' },
            HostConfig: { NetworkMode: 'bridge' },
            NetworkingConfig: {
                EndpointsConfig: { test: { Aliases: ['test'] } },
            },
        },
    });
    expect(payload._body.name).toBeUndefined();
    expect(payload._body.Env).toEqual(spec.Env);
    expect(payload._body.Labels).toEqual(spec.Labels);
    expect(payload._body.HostConfig).toEqual(spec.HostConfig);
    expect(payload._body.NetworkingConfig).toEqual(spec.NetworkingConfig);
});

test('createContainer should omit the name query parameter when the spec has no name', async () => {
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({ id: 'x' }),
    };

    await docker.createContainer(
        dockerApi,
        { Image: 'test/test:1.2.3' },
        'container-name',
        buildLogger(),
    );

    expect(dockerApi.createContainer.mock.calls[0][0]._query).toEqual({});
});

const buildSwap = (overrides = {}) => ({
    container: { name: 'main-host', id: 'store-id' },
    success: true,
    newContainerId: 'new-host-id',
    startedAfterSwap: true,
    oldContainerId: 'abcdef1234567890abcdef1234567890',
    ...overrides,
});

test('waitForPostUpdateReady should not be ready when the container was not started', async () => {
    const inspect = jest.fn();
    const dockerApi = { getContainer: jest.fn(() => ({ inspect })) };
    await expect(
        docker.waitForPostUpdateReady(
            dockerApi,
            buildSwap({ startedAfterSwap: false }),
            1000,
        ),
    ).resolves.toEqual({
        ready: false,
        reason: 'container not started after update',
    });
    expect(inspect).not.toHaveBeenCalled();
});

test('waitForPostUpdateReady should poll until the container is healthy', async () => {
    jest.spyOn(docker, 'getPostupdatePollIntervalMs').mockReturnValue(1);
    const inspect = jest
        .fn()
        .mockResolvedValueOnce({
            State: { Running: true, Health: { Status: 'starting' } },
        })
        .mockResolvedValueOnce({
            State: { Running: true, Health: { Status: 'starting' } },
        })
        .mockResolvedValueOnce({
            State: { Running: true, Health: { Status: 'healthy' } },
        });
    const dockerApi = { getContainer: jest.fn(() => ({ inspect })) };
    await expect(
        docker.waitForPostUpdateReady(dockerApi, buildSwap(), 5000),
    ).resolves.toEqual({ ready: true });
    expect(inspect).toHaveBeenCalledTimes(3);
    expect(dockerApi.getContainer).toHaveBeenCalledWith('new-host-id');
    jest.restoreAllMocks();
});

test('waitForPostUpdateReady should be ready on running when there is no healthcheck', async () => {
    jest.spyOn(docker, 'getPostupdatePollIntervalMs').mockReturnValue(1);
    const inspect = jest
        .fn()
        .mockResolvedValueOnce({ State: { Running: false } })
        .mockResolvedValueOnce({ State: { Running: true } });
    const dockerApi = { getContainer: jest.fn(() => ({ inspect })) };
    await expect(
        docker.waitForPostUpdateReady(dockerApi, buildSwap(), 5000),
    ).resolves.toEqual({ ready: true });
    expect(inspect).toHaveBeenCalledTimes(2);
    jest.restoreAllMocks();
});

test('waitForPostUpdateReady should fail immediately when the container is unhealthy', async () => {
    jest.spyOn(docker, 'getPostupdatePollIntervalMs').mockReturnValue(1);
    const inspect = jest.fn().mockResolvedValue({
        State: { Running: true, Health: { Status: 'unhealthy' } },
    });
    const dockerApi = { getContainer: jest.fn(() => ({ inspect })) };
    await expect(
        docker.waitForPostUpdateReady(dockerApi, buildSwap(), 5000),
    ).resolves.toEqual({ ready: false, reason: 'unhealthy' });
    expect(inspect).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('waitForPostUpdateReady should fail when the inspect call fails', async () => {
    jest.spyOn(docker, 'getPostupdatePollIntervalMs').mockReturnValue(1);
    const inspect = jest.fn().mockRejectedValue(new Error('no such container'));
    const dockerApi = { getContainer: jest.fn(() => ({ inspect })) };
    await expect(
        docker.waitForPostUpdateReady(dockerApi, buildSwap(), 5000),
    ).resolves.toEqual({ ready: false, reason: 'no such container' });
    jest.restoreAllMocks();
});

test('waitForPostUpdateReady should fail on timeout', async () => {
    jest.spyOn(docker, 'getPostupdatePollIntervalMs').mockReturnValue(1);
    const inspect = jest.fn().mockResolvedValue({
        State: { Running: true, Health: { Status: 'starting' } },
    });
    const dockerApi = { getContainer: jest.fn(() => ({ inspect })) };
    const result = await docker.waitForPostUpdateReady(
        dockerApi,
        buildSwap(),
        5,
    );
    expect(result.ready).toEqual(false);
    expect(result.reason).toContain('health gate timeout');
    jest.restoreAllMocks();
});

test('getPostupdateRestartNames should parse, trim and drop empty names', () => {
    expect(
        docker.getPostupdateRestartNames({
            labels: {
                'wud.postupdate.restart': ' first , second,, third ',
            },
        }),
    ).toEqual(['first', 'second', 'third']);
});

test('getPostupdateRestartNames should return an empty array when the label is absent', () => {
    expect(docker.getPostupdateRestartNames({ labels: {} })).toEqual([]);
    expect(docker.getPostupdateRestartNames({})).toEqual([]);
});

test('resolveDependent should match the exact container name', async () => {
    const dockerApi = {
        listContainers: jest.fn().mockResolvedValue([
            { Id: 'id-other', Names: ['/qbittorrent-exporter'] },
            { Id: 'id-dep', Names: ['/qbittorrent'] },
        ]),
    };
    await expect(
        docker.resolveDependent(dockerApi, 'qbittorrent', buildLogger()),
    ).resolves.toEqual({ id: 'id-dep', name: 'qbittorrent' });
    expect(dockerApi.listContainers).toHaveBeenCalledWith({ all: true });
});

test('resolveDependent should not match on substrings', async () => {
    const dockerApi = {
        listContainers: jest
            .fn()
            .mockResolvedValue([{ Id: 'id-dep', Names: ['/qbittorrent'] }]),
    };
    await expect(
        docker.resolveDependent(dockerApi, 'qbit', buildLogger()),
    ).resolves.toBeUndefined();
});

test('resolveDependent should fall back to hash-prefixed names', async () => {
    const dockerApi = {
        listContainers: jest
            .fn()
            .mockResolvedValue([
                { Id: 'id-dep', Names: ['/abcdef123456_qbittorrent'] },
            ]),
    };
    await expect(
        docker.resolveDependent(dockerApi, 'qbittorrent', buildLogger()),
    ).resolves.toEqual({ id: 'id-dep', name: 'abcdef123456_qbittorrent' });
});

test('resolveDependent should prefer the exact match over the hash-prefixed one', async () => {
    const dockerApi = {
        listContainers: jest.fn().mockResolvedValue([
            { Id: 'id-temp', Names: ['/abcdef123456_qbittorrent'] },
            { Id: 'id-dep', Names: ['/qbittorrent'] },
        ]),
    };
    await expect(
        docker.resolveDependent(dockerApi, 'qbittorrent', buildLogger()),
    ).resolves.toEqual({ id: 'id-dep', name: 'qbittorrent' });
});

test('resolveDependent should return undefined when the daemon call fails', async () => {
    const logger = buildLogger();
    const dockerApi = {
        listContainers: jest.fn().mockRejectedValue(new Error('daemon down')),
    };
    await expect(
        docker.resolveDependent(dockerApi, 'qbittorrent', logger),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
});

const buildDependentSpec = (overrides = {}) => ({
    Name: '/dependent',
    Id: 'dep-id',
    Config: { Image: 'dep/image:1.0.0' },
    HostConfig: { NetworkMode: 'bridge' },
    NetworkSettings: { Networks: {} },
    State: { Running: true },
    ...overrides,
});

const buildDependentApi = (spec) => {
    const restart = jest.fn().mockResolvedValue(undefined);
    const stop = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const wait = jest.fn().mockResolvedValue(undefined);
    const start = jest.fn().mockResolvedValue(undefined);
    const createContainer = jest
        .fn()
        .mockResolvedValue({ id: 'dep-new-id', start });
    const dockerApi = {
        createContainer,
        getContainer: jest.fn(() => ({
            inspect: jest.fn().mockResolvedValue(spec),
            restart,
            stop,
            remove,
            wait,
        })),
    };
    return { dockerApi, restart, stop, remove, wait, start, createContainer };
};

test('bounceDependent should restart a dependent that does not reference the host', async () => {
    const { dockerApi, restart, createContainer } =
        buildDependentApi(buildDependentSpec());
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            buildSwap(),
            'main-host',
            buildLogger(),
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'bounced',
        method: 'restart',
    });
    expect(restart).toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
});

test('bounceDependent should skip a stopped dependent that does not reference the host', async () => {
    const { dockerApi, restart, stop, remove, createContainer } =
        buildDependentApi(buildDependentSpec({ State: { Running: false } }));
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            buildSwap(),
            'main-host',
            buildLogger(),
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'skipped',
        reason: 'not running',
    });
    expect(restart).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
});

test('bounceDependent should recreate a dependent referencing the host by id', async () => {
    const swap = buildSwap();
    const { dockerApi, stop, remove, wait, start, createContainer } =
        buildDependentApi(
            buildDependentSpec({
                HostConfig: {
                    NetworkMode: `container:${swap.oldContainerId}`,
                },
            }),
        );
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            buildLogger(),
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'bounced',
        method: 'recreate',
    });
    expect(stop).toHaveBeenCalled();
    expect(remove).toHaveBeenCalled();
    expect(wait).not.toHaveBeenCalled();
    expect(
        createContainer.mock.calls[0][0]._body.HostConfig.NetworkMode,
    ).toEqual('container:new-host-id');
    expect(start).toHaveBeenCalled();
});

test('bounceDependent should recreate a dependent referencing the host by short id', async () => {
    const swap = buildSwap();
    const { dockerApi, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: {
                NetworkMode: `container:${swap.oldContainerId.slice(0, 12)}`,
            },
        }),
    );
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            buildLogger(),
        ),
    ).resolves.toMatchObject({ status: 'bounced', method: 'recreate' });
    expect(createContainer).toHaveBeenCalled();
});

test('bounceDependent should recreate a dependent referencing the host by name', async () => {
    const { dockerApi, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: { NetworkMode: 'container:main-host' },
        }),
    );
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            buildSwap(),
            'main-host',
            buildLogger(),
        ),
    ).resolves.toMatchObject({ status: 'bounced', method: 'recreate' });
    expect(createContainer).toHaveBeenCalled();
});

test('bounceDependent should restart when a short non-hex reference prefixes the old id', async () => {
    const { dockerApi, restart, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: { NetworkMode: 'container:ab' },
        }),
    );
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            buildSwap(),
            'main-host',
            buildLogger(),
        ),
    ).resolves.toMatchObject({ status: 'bounced', method: 'restart' });
    expect(restart).toHaveBeenCalled();
    expect(createContainer).not.toHaveBeenCalled();
});

test('bounceDependent should wait for auto-removal instead of removing', async () => {
    const swap = buildSwap();
    const { dockerApi, remove, wait, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: {
                AutoRemove: true,
                NetworkMode: `container:${swap.oldContainerId}`,
            },
        }),
    );
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            buildLogger(),
        ),
    ).resolves.toMatchObject({ status: 'bounced', method: 'recreate' });
    expect(wait).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(createContainer).toHaveBeenCalled();
});

test('bounceDependent should recreate a stopped id-referencing dependent without starting it', async () => {
    const swap = buildSwap();
    const { dockerApi, stop, start, createContainer } = buildDependentApi(
        buildDependentSpec({
            State: { Running: false },
            HostConfig: {
                NetworkMode: `container:${swap.oldContainerId}`,
            },
        }),
    );
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            buildLogger(),
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'bounced',
        method: 'recreate',
        reason: 'recreated but left stopped',
    });
    expect(stop).not.toHaveBeenCalled();
    expect(createContainer).toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
});

test('bounceDependent should report a failure when the docker call throws', async () => {
    const { dockerApi } = buildDependentApi(buildDependentSpec());
    dockerApi.getContainer = jest.fn(() => ({
        inspect: jest.fn().mockResolvedValue(buildDependentSpec()),
        restart: jest.fn().mockRejectedValue(new Error('restart failed')),
    }));
    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            buildSwap(),
            'main-host',
            buildLogger(),
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'failed',
        reason: 'restart failed',
    });
});

const buildHostSwap = (name, label, overrides = {}) => ({
    container: {
        id: `${name}-store-id`,
        name,
        watcher: 'test',
        labels: label ? { 'wud.postupdate.restart': label } : {},
    },
    success: true,
    newContainerId: `new-${name}-id`,
    startedAfterSwap: true,
    oldContainerId: `old-${name}-id`,
    ...overrides,
});

const buildPostUpdateEnv = () => {
    const dockerApi = { listContainers: jest.fn().mockResolvedValue([]) };
    const watcherSpy = jest
        .spyOn(docker, 'getWatcher')
        .mockReturnValue({ dockerApi });
    const gateSpy = jest
        .spyOn(docker, 'waitForPostUpdateReady')
        .mockResolvedValue({ ready: true });
    const resolveSpy = jest
        .spyOn(docker, 'resolveDependent')
        .mockImplementation(async (api, name) => ({ id: `${name}-id`, name }));
    const bounceSpy = jest
        .spyOn(docker, 'bounceDependent')
        .mockImplementation(async (api, resolved, swap, hostName) => ({
            name: resolved.name,
            host: hostName,
            status: 'bounced',
            method: 'restart',
        }));
    const counterSpy = jest
        .spyOn(docker, 'increasePostupdateBounceCounter')
        .mockImplementation(() => undefined);
    return {
        dockerApi,
        watcherSpy,
        gateSpy,
        resolveSpy,
        bounceSpy,
        counterSpy,
    };
};

test('runPostUpdate should bounce the label dependents in label order', async () => {
    const { bounceSpy, counterSpy } = buildPostUpdateEnv();
    const swap = buildHostSwap('main', ' first , second,, third ');
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([
        { name: 'first', host: 'main', status: 'bounced', method: 'restart' },
        {
            name: 'second',
            host: 'main',
            status: 'bounced',
            method: 'restart',
        },
        { name: 'third', host: 'main', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(3);
    expect(counterSpy).toHaveBeenCalledTimes(3);
    expect(counterSpy).toHaveBeenCalledWith('bounced');
    jest.restoreAllMocks();
});

test('runPostUpdate should skip a self-referencing dependent', async () => {
    const { bounceSpy } = buildPostUpdateEnv();
    const swap = buildHostSwap('main', 'main,other');
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([
        {
            name: 'main',
            host: 'main',
            status: 'skipped',
            reason: 'self-reference',
        },
        { name: 'other', host: 'main', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('runPostUpdate should skip a dependent that is also a batch member', async () => {
    const { bounceSpy } = buildPostUpdateEnv();
    const swap = buildHostSwap('main', 'sibling,other');
    await expect(
        docker.runPostUpdate([swap], new Set(['main', 'sibling'])),
    ).resolves.toEqual([
        {
            name: 'sibling',
            host: 'main',
            status: 'skipped',
            reason: 'batch member, already updated',
        },
        { name: 'other', host: 'main', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('runPostUpdate should report a failed batch member dependent as update failed', async () => {
    const { bounceSpy } = buildPostUpdateEnv();
    const swapMain = buildHostSwap('main', 'sibling,other');
    const swapSibling = buildHostSwap('sibling', '', { success: false });
    await expect(
        docker.runPostUpdate(
            [swapMain, swapSibling],
            new Set(['main', 'sibling']),
        ),
    ).resolves.toEqual([
        {
            name: 'sibling',
            host: 'main',
            status: 'skipped',
            reason: 'batch member, update failed',
        },
        { name: 'other', host: 'main', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('runPostUpdate should bounce a shared dependent once (first host wins)', async () => {
    const { bounceSpy } = buildPostUpdateEnv();
    const swapA = buildHostSwap('hostA', 'shared');
    const swapB = buildHostSwap('hostB', 'shared');
    await expect(
        docker.runPostUpdate([swapA, swapB], new Set(['hostA', 'hostB'])),
    ).resolves.toEqual([
        { name: 'shared', host: 'hostA', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('runPostUpdate should do nothing without any label', async () => {
    const { gateSpy, resolveSpy, bounceSpy, counterSpy } = buildPostUpdateEnv();
    const swap = buildHostSwap('main', undefined);
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([]);
    expect(gateSpy).not.toHaveBeenCalled();
    expect(resolveSpy).not.toHaveBeenCalled();
    expect(bounceSpy).not.toHaveBeenCalled();
    expect(counterSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

test('runPostUpdate should ignore the dependents of a failed swap', async () => {
    const { bounceSpy } = buildPostUpdateEnv();
    const failed = buildHostSwap('main', 'dep', {
        success: false,
        error: 'boom',
    });
    await expect(
        docker.runPostUpdate([failed], new Set(['main'])),
    ).resolves.toEqual([]);
    expect(bounceSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

test('runPostUpdate should skip every dependent of a host that fails the health gate', async () => {
    const { gateSpy, bounceSpy, counterSpy } = buildPostUpdateEnv();
    gateSpy.mockResolvedValue({ ready: false, reason: 'unhealthy' });
    const swap = buildHostSwap('main', 'first,second');
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([
        {
            name: 'first',
            host: 'main',
            status: 'skipped',
            reason: 'health gate: unhealthy',
        },
        {
            name: 'second',
            host: 'main',
            status: 'skipped',
            reason: 'health gate: unhealthy',
        },
    ]);
    expect(gateSpy).toHaveBeenCalledTimes(1);
    expect(bounceSpy).not.toHaveBeenCalled();
    expect(counterSpy).toHaveBeenCalledWith('skipped');
    jest.restoreAllMocks();
});

test('runPostUpdate should gate each host separately', async () => {
    const { gateSpy, bounceSpy } = buildPostUpdateEnv();
    gateSpy.mockImplementation(async (api, swap) =>
        swap.container.name === 'hostA'
            ? { ready: false, reason: 'unhealthy' }
            : { ready: true },
    );
    const swapA = buildHostSwap('hostA', 'depA');
    const swapB = buildHostSwap('hostB', 'depB');
    await expect(
        docker.runPostUpdate([swapA, swapB], new Set(['hostA', 'hostB'])),
    ).resolves.toEqual([
        {
            name: 'depA',
            host: 'hostA',
            status: 'skipped',
            reason: 'health gate: unhealthy',
        },
        { name: 'depB', host: 'hostB', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('runPostUpdate should report an unresolved dependent as skipped and keep going', async () => {
    const { resolveSpy, bounceSpy } = buildPostUpdateEnv();
    resolveSpy.mockImplementation(async (api, name) =>
        name === 'ghost' ? undefined : { id: `${name}-id`, name },
    );
    const swap = buildHostSwap('main', 'ghost,real');
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([
        {
            name: 'ghost',
            host: 'main',
            status: 'skipped',
            reason: 'unresolved',
        },
        { name: 'real', host: 'main', status: 'bounced', method: 'restart' },
    ]);
    expect(bounceSpy).toHaveBeenCalledTimes(1);
    jest.restoreAllMocks();
});

test('runPostUpdate should report the dependent under its label name', async () => {
    const { resolveSpy, bounceSpy } = buildPostUpdateEnv();
    resolveSpy.mockResolvedValue({ id: 'dep-id', name: 'abcdef123456_dep' });
    bounceSpy.mockResolvedValue({
        name: 'abcdef123456_dep',
        host: 'main',
        status: 'bounced',
        method: 'recreate',
    });
    const swap = buildHostSwap('main', 'dep');
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([
        { name: 'dep', host: 'main', status: 'bounced', method: 'recreate' },
    ]);
    jest.restoreAllMocks();
});

test('runPostUpdate should keep processing after a failed bounce', async () => {
    const { bounceSpy, counterSpy } = buildPostUpdateEnv();
    bounceSpy.mockImplementation(async (api, resolved, swap, hostName) =>
        resolved.name === 'first'
            ? {
                  name: resolved.name,
                  host: hostName,
                  status: 'failed',
                  reason: 'restart failed',
              }
            : {
                  name: resolved.name,
                  host: hostName,
                  status: 'bounced',
                  method: 'restart',
              },
    );
    const swap = buildHostSwap('main', 'first,second');
    await expect(
        docker.runPostUpdate([swap], new Set(['main'])),
    ).resolves.toEqual([
        {
            name: 'first',
            host: 'main',
            status: 'failed',
            reason: 'restart failed',
        },
        { name: 'second', host: 'main', status: 'bounced', method: 'restart' },
    ]);
    expect(counterSpy).toHaveBeenCalledWith('failed');
    expect(counterSpy).toHaveBeenCalledWith('bounced');
    jest.restoreAllMocks();
});

test('runPostUpdate should increment the Prometheus counter for every outcome', async () => {
    const { dockerApi } = buildPostUpdateEnv();
    jest.spyOn(docker, 'increasePostupdateBounceCounter').mockRestore();
    const counter = { inc: jest.fn() };
    jest.spyOn(
        require('../../../prometheus/postupdate'),
        'getPostupdateBounceCounter',
    ).mockReturnValue(counter);
    const swap = buildHostSwap('main', 'first');
    await docker.runPostUpdate([swap], new Set(['main']));
    expect(dockerApi).toBeDefined();
    expect(counter.inc).toHaveBeenCalledWith({
        type: docker.type,
        name: docker.name,
        status: 'bounced',
    });
    jest.restoreAllMocks();
});

test('trigger should run the post-update epilogue with the updated container', async () => {
    const swapOutcome = {
        container: happyContainer,
        success: true,
        newContainerId: 'new-container-id',
        startedAfterSwap: true,
        oldContainerId: '123456798',
    };
    jest.spyOn(docker, 'pullContainer').mockResolvedValue({});
    jest.spyOn(docker, 'swapContainer').mockResolvedValue(swapOutcome);
    const postUpdateSpy = jest
        .spyOn(docker, 'runPostUpdate')
        .mockResolvedValue([
            {
                name: 'dep',
                host: 'container-name',
                status: 'bounced',
                method: 'restart',
            },
        ]);
    await expect(docker.trigger(happyContainer)).resolves.toEqual({
        members: [
            { id: '123456789', name: 'container-name', status: 'updated' },
        ],
        dependents: [
            {
                name: 'dep',
                host: 'container-name',
                status: 'bounced',
                method: 'restart',
            },
        ],
    });
    expect(postUpdateSpy).toHaveBeenCalledWith(
        [swapOutcome],
        new Set(['container-name']),
    );
    jest.restoreAllMocks();
});

test('trigger should reject and skip the epilogue when the swap fails', async () => {
    jest.spyOn(docker, 'pullContainer').mockResolvedValue({});
    jest.spyOn(docker, 'swapContainer').mockRejectedValue(
        new Error('swap failed'),
    );
    const postUpdateSpy = jest.spyOn(docker, 'runPostUpdate');
    await expect(docker.trigger(happyContainer)).rejects.toThrowError(
        'swap failed',
    );
    expect(postUpdateSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

test('trigger should not run the epilogue under dry-run', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    const postUpdateSpy = jest.spyOn(docker, 'runPostUpdate');
    await expect(docker.trigger(happyContainer)).resolves.toBeUndefined();
    expect(postUpdateSpy).not.toHaveBeenCalled();
    docker.configuration = configurationValid;
    jest.restoreAllMocks();
});

test('triggerBatch should report a failed member and still bounce the sibling dependents', async () => {
    const good = { id: 'good', name: 'good', watcher: 'test' };
    const bad = { id: 'bad', name: 'bad', watcher: 'test' };
    jest.spyOn(docker, 'pullContainer').mockImplementation(async (c) => ({
        currentContainerSpec: { Id: `spec-${c.id}` },
    }));
    jest.spyOn(docker, 'swapContainer').mockImplementation(async (c) => {
        if (c.id === 'bad') {
            throw new Error('swap failed');
        }
        return buildSwapMock(c);
    });
    const postUpdateSpy = jest
        .spyOn(docker, 'runPostUpdate')
        .mockResolvedValue([
            { name: 'dep', host: 'good', status: 'bounced', method: 'restart' },
        ]);
    const result = await docker.triggerBatch([good, bad]);
    expect(result.members).toEqual([
        { id: 'good', name: 'good', status: 'updated' },
        { id: 'bad', name: 'bad', status: 'failed', error: 'swap failed' },
    ]);
    expect(result.dependents).toEqual([
        { name: 'dep', host: 'good', status: 'bounced', method: 'restart' },
    ]);
    const [swaps, memberNames] = postUpdateSpy.mock.calls[0];
    expect(swaps.map((s) => s.success)).toEqual([true, false]);
    expect(swaps[1]).toEqual({
        container: bad,
        success: false,
        startedAfterSwap: false,
        oldContainerId: 'spec-bad',
        error: 'swap failed',
    });
    expect(memberNames).toEqual(new Set(['good', 'bad']));
    jest.restoreAllMocks();
});

test('trigger should throw ContainerGoneError when the container no longer exists', async () => {
    jest.spyOn(docker, 'pullContainer').mockResolvedValue(undefined);
    const swapSpy = jest.spyOn(docker, 'swapContainer');
    await expect(docker.trigger(happyContainer)).rejects.toBeInstanceOf(
        ContainerGoneError,
    );
    await expect(docker.trigger(happyContainer)).rejects.toThrowError(
        'Container container-name no longer exists',
    );
    expect(swapSpy).not.toHaveBeenCalled();
    jest.restoreAllMocks();
});

test('trigger should still resolve undefined under dry-run', async () => {
    docker.configuration = { ...configurationValid, dryrun: true };
    await expect(docker.trigger(happyContainer)).resolves.toBeUndefined();
    docker.configuration = configurationValid;
    jest.restoreAllMocks();
});

test('swapAll should mark a context-less member gone and toMemberOutcomes should propagate it', async () => {
    const gone = { id: 'gone', name: 'gone', watcher: 'test' };
    const live = { id: 'live', name: 'live', watcher: 'test' };
    jest.spyOn(docker, 'swapContainer').mockImplementation(async (c) =>
        buildSwapMock(c),
    );
    const swaps = await docker.swapAll(
        [gone, live],
        [undefined, { currentContainerSpec: { Id: 'spec-live' } }],
    );
    expect(swaps[0]).toEqual({
        container: gone,
        success: false,
        startedAfterSwap: false,
        oldContainerId: 'gone',
        error: 'Container gone no longer exists',
        gone: true,
    });
    expect(swaps[1].gone).toBeUndefined();
    expect(docker.toMemberOutcomes(swaps)).toEqual([
        {
            id: 'gone',
            name: 'gone',
            status: 'failed',
            error: 'Container gone no longer exists',
            gone: true,
        },
        { id: 'live', name: 'live', status: 'updated' },
    ]);
    jest.restoreAllMocks();
});
