// @ts-nocheck
import { ValidationError } from 'joi';
import Docker from './Docker';
import { ContainerGoneError, SwapFailedError } from './errors';
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
                                            Image: 'sha256:old',
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
                                inspect: () =>
                                    image === 'sha256:old'
                                        ? Promise.resolve({
                                              Id: 'sha256:old',
                                              Config: {},
                                          })
                                        : Promise.resolve({
                                              Id: 'sha256:new',
                                              Config: {},
                                          }),
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

afterEach(() => {
    jest.restoreAllMocks();
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

test('renameContainer should rename container from dockerApi', async () => {
    const rename = jest.fn().mockResolvedValue(undefined);
    await expect(
        docker.renameContainer({ rename }, 'name', 'x', 'id', log),
    ).resolves.toBeUndefined();
    expect(rename).toHaveBeenCalledWith({ name: 'x' });
});

test('renameContainer should warn and throw when error occurs', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    await expect(
        docker.renameContainer(
            {
                rename: () => Promise.reject(new Error('No container')),
            },
            'name',
            'x',
            'id',
            logger,
        ),
    ).rejects.toThrowError('No container');
    expect(logger.warn).toHaveBeenCalled();
});

test('renameContainer should reject when the container has no rename method', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
    await expect(
        docker.renameContainer({}, 'name', 'x', 'id', logger),
    ).rejects.toThrow();
    expect(logger.warn).toHaveBeenCalled();
});

test('buildAsideName should suffix the container name with the container id', () => {
    expect(docker.buildAsideName('container-name', '123456789')).toEqual(
        'container-name_wud_old_123456789',
    );
});

test('buildAsideName should truncate the container id to 12 characters', () => {
    const id =
        'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';
    expect(id).toHaveLength(64);
    expect(docker.buildAsideName('container-name', id)).toEqual(
        'container-name_wud_old_a1b2c3d4e5f6',
    );
});

test('buildAsideName should not produce a dependent id prefix', () => {
    expect(docker.buildAsideName('container-name', 'abcdef123456')).not.toMatch(
        /^[a-f0-9]{8,12}_/,
    );
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
                    Aliases: ['test'],
                },
            },
        },
    });
});

test('clone should sanitize read-only endpoint fields', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: 'abcdef1234567890',
            HostConfig: {},
            Config: {},
            NetworkSettings: {
                Networks: {
                    mynet: {
                        NetworkID: 'net-id',
                        EndpointID: 'endpoint-id',
                        Gateway: '172.18.0.1',
                        IPAddress: '172.18.0.5',
                        IPPrefixLen: 16,
                        GlobalIPv6Address: 'fe80::1',
                        DNSNames: ['web'],
                        IPAMConfig: { IPv4Address: '172.18.0.5' },
                        Aliases: ['abcdef123456', 'web'],
                        MacAddress: '02:42:ac:12:00:05',
                    },
                },
            },
        },
        'test/test:2.0.0',
    );
    const endpoint = clone.NetworkingConfig.EndpointsConfig.mynet;
    expect(endpoint.NetworkID).toBeUndefined();
    expect(endpoint.EndpointID).toBeUndefined();
    expect(endpoint.Gateway).toBeUndefined();
    expect(endpoint.IPAddress).toBeUndefined();
    expect(endpoint.IPPrefixLen).toBeUndefined();
    expect(endpoint.GlobalIPv6Address).toBeUndefined();
    expect(endpoint.DNSNames).toBeUndefined();
    expect(endpoint.IPAMConfig).toEqual({ IPv4Address: '172.18.0.5' });
    expect(endpoint.MacAddress).toEqual('02:42:ac:12:00:05');
    expect(endpoint.Aliases).toEqual(['web']);
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

test('clone should use the supplied config instead of the container config', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789',
            HostConfig: {},
            Config: {
                Env: ['FROM=container'],
                Labels: { a: 'container' },
            },
            NetworkSettings: {
                Networks: {},
            },
        },
        'test/test:2.0.0',
        {
            Env: ['FROM=derived'],
            Labels: { a: 'derived' },
        },
    );
    expect(clone.Env).toEqual(['FROM=derived']);
    expect(clone.Labels).toEqual({ a: 'derived' });
});

test('clone should apply the container:* deletions to the supplied config', async () => {
    const clone = docker.cloneContainer(
        {
            Name: '/test',
            Id: '123456789',
            HostConfig: {
                NetworkMode: 'container:sidecar',
            },
            Config: {
                Hostname: 'container-host',
            },
            NetworkSettings: {
                Networks: {},
            },
        },
        'test/test:2.0.0',
        {
            Hostname: 'derived-host',
            ExposedPorts: { '8080/tcp': {} },
        },
    );
    expect(clone.Hostname).toBeUndefined();
    expect(clone.ExposedPorts).toBeUndefined();
});

test('inspectImage should return undefined and warn when the inspect fails', async () => {
    const warn = jest.fn();
    const fakeLogger = { warn, info: jest.fn(), debug: jest.fn() };
    const dockerApi = {
        getImage: () =>
            Promise.resolve({
                inspect: () => Promise.reject(new Error('boom')),
            }),
    };
    const result = await docker.inspectImage(dockerApi, 'sha256:x', fakeLogger);
    expect(result).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
        'Error when inspecting image sha256:x (boom)',
    );
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

test('pullContainer should capture both image specs on the happy path', async () => {
    const ctx = await docker.pullContainer(happyContainer);
    expect(ctx.currentImageSpec.Id).toBe('sha256:old');
    expect(ctx.newImageId).toBe('sha256:new');
});

test('pullContainer should still pull when the old image inspect fails', async () => {
    const pullImage = jest.spyOn(docker, 'pullImage');
    jest.spyOn(docker, 'inspectImage').mockResolvedValueOnce(undefined);
    const ctx = await docker.pullContainer(happyContainer);
    expect(ctx.currentImageSpec).toBeUndefined();
    expect(ctx.newImageId).toBe('sha256:new');
    expect(pullImage).toHaveBeenCalled();
});

test('pullContainer should leave newImageId undefined when the new image inspect fails', async () => {
    jest.spyOn(docker, 'inspectImage')
        .mockResolvedValueOnce({ Id: 'sha256:old', Config: {} })
        .mockResolvedValueOnce(undefined);
    const ctx = await docker.pullContainer(happyContainer);
    expect(ctx.currentImageSpec).toEqual({ Id: 'sha256:old', Config: {} });
    expect(ctx.newImageId).toBeUndefined();
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

test('swapContainer should run stop, rename, create, start and remove the aside on the happy path', async () => {
    const calls = [];
    const stop = jest.fn(async () => {
        calls.push('stop');
    });
    const rename = jest.fn(async () => {
        calls.push('rename');
    });
    const remove = jest.fn(async () => {
        calls.push('remove');
    });
    const wait = jest.fn().mockResolvedValue(undefined);
    const newStart = jest.fn(async () => {
        calls.push('start');
    });
    const dockerApi = {
        createContainer: jest.fn(async () => {
            calls.push('create');
            return { id: 'new-container-id', start: newStart };
        }),
    };
    const ctx = {
        dockerApi,
        registry: {
            getImageFullName: () => 'my-registry/test/test:1.2.3',
        },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: { stop, rename, remove, wait },
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
    expect(calls).toEqual(['stop', 'rename', 'create', 'start', 'remove']);
    expect(rename).toHaveBeenCalledWith({
        name: 'container-name_wud_old_123456789',
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
});

test('swapContainer should wait for auto-removal when HostConfig.AutoRemove is true', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const rename = jest.fn().mockResolvedValue(undefined);
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
        currentContainer: { stop, rename, remove, wait },
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
    expect(rename).not.toHaveBeenCalled();
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
    const rename = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const newStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({ start: newStart }),
    };
    const ctx = {
        dockerApi,
        registry: { getImageFullName: () => 'my-registry/test/test:1.2.3' },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: { stop, rename, remove },
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
    expect(rename).toHaveBeenCalled();
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
            rename: jest.fn().mockResolvedValue(undefined),
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

test('swapContainer should roll the original back when the create fails', async () => {
    const stop = jest.fn().mockResolvedValue(undefined);
    const rename = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const originalStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValue(new Error('create exploded')),
    };
    const ctx = {
        dockerApi,
        registry: { getImageFullName: () => 'my-registry/test/test:1.2.3' },
        newImage: 'my-registry/test/test:4.5.6',
        currentContainer: { stop, rename, remove, start: originalStart },
        currentContainerSpec: {
            Name: '/container-name',
            Id: '123456789',
            Config: { Image: 'my-registry/test/test:1.2.3' },
            HostConfig: {},
            NetworkSettings: { Networks: {} },
            State: { Running: true },
        },
        state: { Running: true },
    };
    const error = await docker
        .swapContainer({ name: 'container-name', id: '123456789' }, ctx)
        .then(
            () => undefined,
            (e) => e,
        );
    expect(error).toBeDefined();
    expect(error.message).toContain('rolled back');
    expect(error.message).toContain('create exploded');
    expect(error.disposition).toBe('rolled_back');
    expect(rename).toHaveBeenNthCalledWith(1, {
        name: 'container-name_wud_old_123456789',
    });
    expect(rename).toHaveBeenNthCalledWith(2, { name: 'container-name' });
    expect(originalStart).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
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
    const removeNew = jest.fn().mockResolvedValue(undefined);
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
            remove: removeNew,
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

    expect(removeNew).toHaveBeenCalled();

    watcherSpy.mockRestore();
});

test('trigger should log an error with the orphan id when the fallback cleanup remove fails', async () => {
    const logger = useLogger();
    const removeNew = jest.fn().mockRejectedValue(new Error('remove failed'));
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
            remove: removeNew,
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

    expect(removeNew).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('created-id'),
    );

    watcherSpy.mockRestore();
});

const buildLogger = () => {
    const logger = {
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
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
    const order = [];
    const track = (label, impl) =>
        jest.fn(async (...args) => {
            order.push(label);
            return impl ? impl(...args) : undefined;
        });
    const restart = track('restart');
    const stop = track('stop');
    const remove = track('remove');
    const wait = track('wait');
    const rename = track('rename');
    const startOriginal = track('original-start');
    const start = track('start');
    const removeNew = track('remove-new');
    const createContainer = track('create', () => ({
        id: 'dep-new-id',
        start,
        remove: removeNew,
    }));
    const dockerApi = {
        createContainer,
        getContainer: jest.fn(() => ({
            inspect: jest.fn().mockResolvedValue(spec),
            restart,
            stop,
            remove,
            wait,
            rename,
            start: startOriginal,
        })),
    };
    return {
        dockerApi,
        order,
        restart,
        stop,
        remove,
        removeNew,
        wait,
        rename,
        start,
        startOriginal,
        createContainer,
    };
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
    const { dockerApi, order, rename, wait, createContainer } =
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
    expect(order).toEqual(['stop', 'rename', 'create', 'start', 'remove']);
    expect(rename).toHaveBeenCalledWith({ name: 'dependent_wud_old_dep-id' });
    expect(wait).not.toHaveBeenCalled();
    expect(
        createContainer.mock.calls[0][0]._body.HostConfig.NetworkMode,
    ).toEqual('container:new-host-id');
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
    const { dockerApi, remove, rename, wait, createContainer } =
        buildDependentApi(
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
    expect(rename).not.toHaveBeenCalled();
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

test('bounceDependent should roll the dependent back when the recreate fails', async () => {
    const swap = buildSwap();
    const { dockerApi, order, rename, remove, startOriginal, createContainer } =
        buildDependentApi(
            buildDependentSpec({
                HostConfig: {
                    NetworkMode: `container:${swap.oldContainerId}`,
                },
            }),
        );
    createContainer.mockImplementation(async () => {
        order.push('create');
        throw new Error('create exploded');
    });

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
        status: 'failed',
        reason: 'recreate failed, dependent rolled back: create exploded',
    });
    expect(order).toEqual([
        'stop',
        'rename',
        'create',
        'rename',
        'original-start',
    ]);
    expect(rename.mock.calls[0][0]).toEqual({
        name: 'dependent_wud_old_dep-id',
    });
    expect(rename.mock.calls[1][0]).toEqual({ name: 'dependent' });
    expect(startOriginal).toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
});

test('bounceDependent should report a restored but unstarted dependent when the restart fails', async () => {
    const swap = buildSwap();
    const logger = buildLogger();
    const { dockerApi, order, startOriginal, createContainer } =
        buildDependentApi(
            buildDependentSpec({
                HostConfig: {
                    NetworkMode: `container:${swap.oldContainerId}`,
                },
            }),
        );
    createContainer.mockRejectedValue(new Error('create exploded'));
    startOriginal.mockRejectedValue(new Error('start exploded'));

    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            logger,
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'failed',
        reason: 'recreate failed; the dependent was restored but could not be started: create exploded',
    });
    expect(order).toEqual(['stop', 'rename', 'rename']);
    expect(startOriginal).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
});

test('bounceDependent should remove the replacement before renaming the aside back', async () => {
    const swap = buildSwap();
    const { dockerApi, order, start, removeNew, startOriginal } =
        buildDependentApi(
            buildDependentSpec({
                HostConfig: {
                    NetworkMode: `container:${swap.oldContainerId}`,
                },
            }),
        );
    start.mockRejectedValue(new Error('start exploded'));

    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            buildLogger(),
        ),
    ).resolves.toMatchObject({
        status: 'failed',
        reason: 'recreate failed, dependent rolled back: start exploded',
    });
    expect(order).toEqual([
        'stop',
        'rename',
        'create',
        'remove-new',
        'rename',
        'original-start',
    ]);
    expect(removeNew).toHaveBeenCalledWith({ force: true });
    expect(startOriginal).toHaveBeenCalled();
});

test('bounceDependent should report a destroyed dependent when the rollback rename fails', async () => {
    const swap = buildSwap();
    const logger = buildLogger();
    const { dockerApi, rename, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: {
                NetworkMode: `container:${swap.oldContainerId}`,
            },
        }),
    );
    createContainer.mockRejectedValue(new Error('create exploded'));
    rename
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('rename back exploded'));

    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            logger,
        ),
    ).resolves.toMatchObject({
        status: 'failed',
        reason: 'recreate failed and the dependent could NOT be restored: create exploded',
    });
    expect(logger.error).toHaveBeenCalled();
});

test('bounceDependent should fall back to removing the dependent when rename is unavailable', async () => {
    const swap = buildSwap();
    const { dockerApi, order, remove, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: {
                NetworkMode: `container:${swap.oldContainerId}`,
            },
        }),
    );
    dockerApi.getContainer = jest.fn(() => ({
        inspect: jest.fn().mockResolvedValue(
            buildDependentSpec({
                HostConfig: {
                    NetworkMode: `container:${swap.oldContainerId}`,
                },
            }),
        ),
        stop: jest.fn(async () => {
            order.push('stop');
        }),
        rename: jest.fn(async () => {
            order.push('rename');
            throw new Error('rename not supported');
        }),
        remove,
    }));

    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            buildLogger(),
        ),
    ).resolves.toMatchObject({ status: 'bounced', method: 'recreate' });
    expect(order).toEqual(['stop', 'rename', 'remove', 'create', 'start']);
    expect(createContainer).toHaveBeenCalled();
});

test('bounceDependent should report an auto-removed dependent as not restored when the recreate fails', async () => {
    const swap = buildSwap();
    const logger = buildLogger();
    const { dockerApi, rename, wait, createContainer } = buildDependentApi(
        buildDependentSpec({
            HostConfig: {
                AutoRemove: true,
                NetworkMode: `container:${swap.oldContainerId}`,
            },
        }),
    );
    createContainer.mockRejectedValue(new Error('create exploded'));

    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            logger,
        ),
    ).resolves.toEqual({
        name: 'dependent',
        host: 'main-host',
        status: 'failed',
        reason: 'recreate failed and the dependent could NOT be restored: create exploded',
    });
    expect(wait).toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
});

test('bounceDependent should not fail the recreate when the aside cannot be removed', async () => {
    const swap = buildSwap();
    const logger = buildLogger();
    const { dockerApi, remove } = buildDependentApi(
        buildDependentSpec({
            HostConfig: {
                NetworkMode: `container:${swap.oldContainerId}`,
            },
        }),
    );
    remove.mockRejectedValue(new Error('aside stuck'));

    await expect(
        docker.bounceDependent(
            dockerApi,
            { id: 'dep-id', name: 'dependent' },
            swap,
            'main-host',
            logger,
        ),
    ).resolves.toMatchObject({ status: 'bounced', method: 'recreate' });
    expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
            'Container dependent_wud_old_dep-id could not be removed after a successful dependent recreate',
        ),
    );
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

const ORIGINAL_IMAGE = 'my-registry/test/test:1.2.3';

const buildRollbackCtx = ({
    currentContainer,
    dockerApi,
    hostConfig = {},
    running = true,
}) => ({
    dockerApi,
    registry: { getImageFullName: () => ORIGINAL_IMAGE },
    newImage: 'my-registry/test/test:4.5.6',
    currentContainer,
    currentContainerSpec: {
        Name: '/container-name',
        Id: '123456789',
        Config: { Image: ORIGINAL_IMAGE },
        HostConfig: hostConfig,
        NetworkSettings: { Networks: {} },
        State: { Running: running },
    },
    state: { Running: running },
});

const swapAndCatch = (
    ctx,
    container = { name: 'container-name', id: '123456789' },
) =>
    docker.swapContainer(container, ctx).then(
        () => undefined,
        (e) => e,
    );

const useLogger = () => {
    const logger = buildLogger();
    jest.spyOn(docker.log, 'child').mockReturnValue(logger);
    return logger;
};

test('swapContainer should remove the replacement before renaming the aside back when the start fails', async () => {
    const logger = useLogger();
    const calls = [];
    const stop = jest.fn(async () => {
        calls.push('stop');
    });
    const rename = jest.fn(async () => {
        calls.push('rename');
    });
    const originalStart = jest.fn(async () => {
        calls.push('original-start');
    });
    const removeNew = jest.fn(async () => {
        calls.push('remove-new');
    });
    const dockerApi = {
        createContainer: jest.fn(async () => {
            calls.push('create');
            return {
                id: 'new-container-id',
                start: jest.fn(async () => {
                    calls.push('new-start');
                    throw new Error('start exploded');
                }),
                remove: removeNew,
            };
        }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop,
            rename,
            remove: jest.fn().mockResolvedValue(undefined),
            start: originalStart,
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(error.message).toContain('start exploded');
    expect(calls).toEqual([
        'stop',
        'rename',
        'create',
        'new-start',
        'remove-new',
        'rename',
        'original-start',
    ]);
    expect(removeNew).toHaveBeenCalledWith({ force: true });
    expect(rename).toHaveBeenNthCalledWith(2, { name: 'container-name' });
    expect(logger.error).not.toHaveBeenCalled();
});

test('swapContainer should fall back to the legacy remove order when rename is unavailable', async () => {
    useLogger();
    const calls = [];
    const stop = jest.fn(async () => {
        calls.push('stop');
    });
    const rename = jest.fn(async () => {
        calls.push('rename');
        throw new Error('rename unsupported');
    });
    const remove = jest.fn(async () => {
        calls.push('remove');
    });
    const newStart = jest.fn(async () => {
        calls.push('start');
    });
    const dockerApi = {
        createContainer: jest.fn(async () => {
            calls.push('create');
            return { id: 'new-container-id', start: newStart };
        }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: { stop, rename, remove },
    });

    await expect(
        docker.swapContainer({ name: 'container-name', id: '123456789' }, ctx),
    ).resolves.toMatchObject({
        success: true,
        newContainerId: 'new-container-id',
    });

    expect(calls).toEqual(['stop', 'rename', 'remove', 'create', 'start']);
    expect(remove).toHaveBeenCalledTimes(1);
});

test('swapContainer should recreate the original from its spec when rename is unavailable and the create fails', async () => {
    useLogger();
    const restoredStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValueOnce(new Error('create exploded'))
            .mockResolvedValue({ id: 'restored-id', start: restoredStart }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest
                .fn()
                .mockRejectedValue(new Error('rename unsupported')),
            remove: jest.fn().mockResolvedValue(undefined),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(dockerApi.createContainer).toHaveBeenCalledTimes(2);
    expect(dockerApi.createContainer.mock.calls[0][0]._body.Image).toBe(
        'my-registry/test/test:4.5.6',
    );
    expect(dockerApi.createContainer.mock.calls[1][0]._body.Image).toBe(
        ORIGINAL_IMAGE,
    );
    expect(restoredStart).toHaveBeenCalled();
});

test('swapContainer should recreate the original from its spec when AutoRemove is set and the create fails', async () => {
    useLogger();
    const rename = jest.fn().mockResolvedValue(undefined);
    const restoredStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValueOnce(new Error('create exploded'))
            .mockResolvedValue({ id: 'restored-id', start: restoredStart }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        hostConfig: { AutoRemove: true },
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename,
            remove: jest.fn().mockResolvedValue(undefined),
            wait: jest.fn().mockResolvedValue(undefined),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(rename).not.toHaveBeenCalled();
    expect(dockerApi.createContainer).toHaveBeenCalledTimes(2);
    expect(dockerApi.createContainer.mock.calls[1][0]._body.Image).toBe(
        ORIGINAL_IMAGE,
    );
    expect(restoredStart).toHaveBeenCalled();
});

test('swapContainer should restart the original when both rename and remove fail', async () => {
    useLogger();
    const originalStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = { createContainer: jest.fn() };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest
                .fn()
                .mockRejectedValue(new Error('rename unsupported')),
            remove: jest.fn().mockRejectedValue(new Error('remove exploded')),
            start: originalStart,
            inspect: jest.fn().mockResolvedValue({}),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(error.message).toContain('remove exploded');
    expect(dockerApi.createContainer).not.toHaveBeenCalled();
    expect(originalStart).toHaveBeenCalled();
});

test('swapContainer should report left_stopped when the original cannot be started again after a failed remove', async () => {
    const logger = useLogger();
    const dockerApi = { createContainer: jest.fn() };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest
                .fn()
                .mockRejectedValue(new Error('rename unsupported')),
            remove: jest.fn().mockRejectedValue(new Error('remove exploded')),
            start: jest.fn().mockRejectedValue(new Error('start exploded')),
            inspect: jest.fn().mockResolvedValue({}),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('left_stopped');
    expect(error.message).toContain('could not be started');
    expect(dockerApi.createContainer).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
});

test('swapContainer should still succeed when the aside container cannot be removed', async () => {
    const logger = useLogger();
    const remove = jest.fn().mockRejectedValue(new Error('remove exploded'));
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({
            id: 'new-container-id',
            start: jest.fn().mockResolvedValue(undefined),
        }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove,
        },
    });

    await expect(
        docker.swapContainer({ name: 'container-name', id: '123456789' }, ctx),
    ).resolves.toMatchObject({
        success: true,
        newContainerId: 'new-container-id',
    });

    expect(remove).toHaveBeenCalledWith({ force: true });
    expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
            'container-name_wud_old_123456789 could not be removed',
        ),
    );
});

test('swapContainer should still succeed when pruning the previous image fails', async () => {
    docker.configuration = { ...configurationValid, prune: true };
    const logger = useLogger();
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({
            id: 'new-container-id',
            start: jest.fn().mockResolvedValue(undefined),
        }),
        getImage: jest.fn().mockResolvedValue({
            remove: jest.fn().mockRejectedValue(new Error('image in use')),
        }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
        },
    });

    await expect(
        docker.swapContainer(
            {
                name: 'container-name',
                id: '123456789',
                image: { name: 'test/test', tag: { value: '1.2.3' } },
                updateKind: { kind: 'tag' },
            },
            ctx,
        ),
    ).resolves.toMatchObject({ success: true });

    expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining(
            `Image ${ORIGINAL_IMAGE} could not be removed after a successful update`,
        ),
    );
    docker.configuration = configurationValid;
});

test('swapAll should carry the swap disposition without leaking it into the member outcomes', async () => {
    const member = { id: 'boom', name: 'boom', watcher: 'test' };
    jest.spyOn(docker, 'swapContainer').mockRejectedValue(
        new SwapFailedError('boom', 'destroyed'),
    );

    const swaps = await docker.swapAll(
        [member],
        [{ currentContainerSpec: { Id: 'spec-boom' } }],
    );

    expect(swaps[0]).toEqual({
        container: member,
        success: false,
        startedAfterSwap: false,
        oldContainerId: 'spec-boom',
        error: 'boom',
        disposition: 'destroyed',
    });
    expect(docker.toMemberOutcomes(swaps)).toEqual([
        { id: 'boom', name: 'boom', status: 'failed', error: 'boom' },
    ]);
    expect(docker.toMemberOutcomes(swaps)[0]).not.toHaveProperty('disposition');
});

test('swapContainer should not start the original when it was not running before a failed create', async () => {
    useLogger();
    const rename = jest.fn().mockResolvedValue(undefined);
    const originalStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValue(new Error('create exploded')),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        running: false,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename,
            remove: jest.fn().mockResolvedValue(undefined),
            start: originalStart,
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(rename).toHaveBeenNthCalledWith(2, { name: 'container-name' });
    expect(originalStart).not.toHaveBeenCalled();
});

test('swapContainer should report destroyed when the aside cannot be renamed back', async () => {
    const logger = useLogger();
    const rename = jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValue(new Error('rename back exploded'));
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValue(new Error('create exploded')),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename,
            remove: jest.fn().mockResolvedValue(undefined),
            start: jest.fn().mockResolvedValue(undefined),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('destroyed');
    expect(error.message).toContain('could NOT be restored');
    expect(error.message).toContain('create exploded');
    expect(error.message).toContain('(rollback: rename back exploded)');
    expect(logger.error).toHaveBeenCalled();
});

test('swapContainer should report destroyed when the replacement cannot be removed during rollback', async () => {
    const logger = useLogger();
    const rename = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest.fn().mockResolvedValue({
            id: 'new-container-id',
            start: jest.fn().mockRejectedValue(new Error('start exploded')),
            remove: jest.fn().mockRejectedValue(new Error('replacement stuck')),
        }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename,
            remove: jest.fn().mockResolvedValue(undefined),
            start: jest.fn().mockResolvedValue(undefined),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('destroyed');
    expect(rename).toHaveBeenCalledTimes(1);
    expect(error.message).toContain('(rollback: replacement stuck)');
    expect(logger.error).toHaveBeenCalled();
});

test('swapContainer should report destroyed when the recreate-from-spec rung also fails', async () => {
    const logger = useLogger();
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValueOnce(new Error('create exploded'))
            .mockRejectedValue(new Error('recreate exploded')),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        hostConfig: { AutoRemove: true },
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
            wait: jest.fn().mockResolvedValue(undefined),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('destroyed');
    expect(error.message).toContain('create exploded');
    expect(error.message).toContain('(rollback: recreate exploded)');
    expect(logger.error).toHaveBeenCalled();
});

test('swapContainer should report left_stopped when the aside is renamed back but cannot start', async () => {
    const logger = useLogger();
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockRejectedValue(new Error('create exploded')),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
            start: jest.fn().mockRejectedValue(new Error('start exploded')),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('left_stopped');
    expect(error.message).toContain('restored but could not be started');
    expect(error.message).toContain('create exploded');
    expect(logger.error).toHaveBeenCalled();
});

test('swapContainer should leave everything untouched when the stop fails', async () => {
    useLogger();
    const rename = jest.fn().mockResolvedValue(undefined);
    const remove = jest.fn().mockResolvedValue(undefined);
    const dockerApi = { createContainer: jest.fn() };
    const ctx = buildRollbackCtx({
        dockerApi,
        currentContainer: {
            stop: jest.fn().mockRejectedValue(new Error('stop exploded')),
            rename,
            remove,
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error).toBeInstanceOf(SwapFailedError);
    expect(error.disposition).toBe('unchanged');
    expect(error.message).toBe('stop exploded');
    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(dockerApi.createContainer).not.toHaveBeenCalled();
});

test('swapContainer should restart the original when the auto-removal wait fails but the container survived', async () => {
    useLogger();
    const originalStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = { createContainer: jest.fn() };
    const ctx = buildRollbackCtx({
        dockerApi,
        hostConfig: { AutoRemove: true },
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
            wait: jest.fn().mockRejectedValue(new Error('wait timed out')),
            inspect: jest.fn().mockResolvedValue({}),
            start: originalStart,
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(error.message).toContain('wait timed out');
    expect(dockerApi.createContainer).not.toHaveBeenCalled();
    expect(originalStart).toHaveBeenCalled();
});

test('swapContainer should recreate the original when the auto-removal wait fails and the container is gone', async () => {
    useLogger();
    const restoredStart = jest.fn().mockResolvedValue(undefined);
    const dockerApi = {
        createContainer: jest
            .fn()
            .mockResolvedValue({ id: 'restored-id', start: restoredStart }),
    };
    const ctx = buildRollbackCtx({
        dockerApi,
        hostConfig: { AutoRemove: true },
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
            wait: jest.fn().mockRejectedValue(new Error('wait timed out')),
            inspect: jest
                .fn()
                .mockRejectedValue(new Error('no such container')),
        },
    });

    const error = await swapAndCatch(ctx);

    expect(error.disposition).toBe('rolled_back');
    expect(dockerApi.createContainer).toHaveBeenCalledTimes(1);
    expect(dockerApi.createContainer.mock.calls[0][0]._body.Image).toBe(
        ORIGINAL_IMAGE,
    );
    expect(restoredStart).toHaveBeenCalled();
});
