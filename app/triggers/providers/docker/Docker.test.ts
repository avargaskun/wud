// @ts-nocheck
import { ValidationError } from 'joi';
import Docker from './Docker';
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
                            if (container.name === 'container-name') {
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
    await expect(docker.trigger(happyContainer)).resolves.toBeUndefined();
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
            HostConfig: {},
            NetworkSettings: { Networks: {} },
            State: { Running: true },
        },
        state: { Running: true },
    };
    await expect(
        docker.swapContainer({ name: 'container-name', id: '123456789' }, ctx),
    ).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();
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

test('triggerBatch should pull every container before swapping any (lockstep)', async () => {
    const order = [];
    jest.spyOn(docker, 'pullContainer').mockImplementation(async () => {
        order.push('pull');
        return {};
    });
    jest.spyOn(docker, 'swapContainer').mockImplementation(async () => {
        order.push('swap');
    });
    await docker.triggerBatch([
        { id: 'a', watcher: 'test' },
        { id: 'b', watcher: 'test' },
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
        .mockResolvedValue(undefined);
    await expect(
        docker.triggerBatch([
            { id: 'good', watcher: 'test' },
            { id: 'bad', watcher: 'test' },
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
        .mockResolvedValue(undefined);
    await docker.triggerBatch([
        { id: 'a', watcher: 'test' },
        { id: 'b', watcher: 'test' },
    ]);
    expect(pullSpy).toHaveBeenCalledTimes(2);
    expect(swapSpy).not.toHaveBeenCalled();
    docker.configuration = configurationValid;
    jest.restoreAllMocks();
});

test('triggerBatch should swap only the containers whose pull returned a context', async () => {
    jest.spyOn(docker, 'pullContainer').mockImplementation(async (c) =>
        c.id === 'gone' ? undefined : { id: c.id },
    );
    const swapSpy = jest
        .spyOn(docker, 'swapContainer')
        .mockResolvedValue(undefined);
    await docker.triggerBatch([
        { id: 'gone', watcher: 'test' },
        { id: 'live', watcher: 'test' },
    ]);
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy.mock.calls[0][0]).toEqual({ id: 'live', watcher: 'test' });
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
    ).resolves.toBeUndefined();
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
    await expect(docker.swapContainer(container, ctx)).resolves.toBeUndefined();
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
    ).resolves.toBeUndefined();

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
    ).resolves.toBeUndefined();

    watcherSpy.mockRestore();

    expect(createContainer).toHaveBeenCalledTimes(2);
    expect(
        Object.keys(
            createContainer.mock.calls[1][0].NetworkingConfig.EndpointsConfig,
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
