import path from 'path';
import fs from 'fs/promises';
import Dockercompose, { doesContainerBelongToCompose } from './Dockercompose';
import log from '../../../log';
import { Container } from '../../../model/container';
import type { ContainerUpdateContext } from '../docker/types';

jest.mock('fs/promises', () => ({
    access: jest.fn(),
    readFile: jest.fn(),
    writeFile: jest.fn(),
    copyFile: jest.fn(),
}));

jest.mock('../../../registry', () => ({
    getState() {
        return {
            watcher: {
                'docker.local': {
                    dockerApi: {
                        modem: { socketPath: '/var/run/docker.sock' },
                    },
                },
                'docker.remote': {
                    dockerApi: { modem: { socketPath: '' } },
                },
            },
            registry: {
                hub: {
                    getAuthPull: async () => undefined,
                    getImageFullName: (
                        image: Container['image'],
                        tagOrDigest: string,
                    ) => `${image.registry.url}/${image.name}:${tagOrDigest}`,
                },
            },
        };
    },
}));

const mockedAccess = fs.access as unknown as jest.Mock;
const mockedReadFile = fs.readFile as unknown as jest.Mock;
const mockedWriteFile = fs.writeFile as unknown as jest.Mock;
const mockedCopyFile = fs.copyFile as unknown as jest.Mock;

const composeYaml = `services:
  zz_batch_compose_1:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
  zz_batch_compose_2:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
`;

const baseConfiguration = {
    prune: false,
    dryrun: false,
    threshold: 'all',
    mode: 'batch',
    once: true,
    auto: true,
    autoremovetimeout: 10000,
    file: '/default/docker-compose.yml',
    backup: false,
    composeFileLabel: 'wud.compose.file',
};

const dockercompose = new Dockercompose();
dockercompose.log = log;

function buildContainer(overrides: Partial<Container> = {}): Container {
    return {
        id: 'container-id',
        name: 'zz_batch_compose_1',
        displayName: 'zz_batch_compose_1',
        displayIcon: 'mdi:docker',
        status: 'running',
        watcher: 'local',
        image: {
            id: 'image-id',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'stefanprodan/podinfo',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
        updateAvailable: true,
        updateKind: {
            kind: 'tag',
            localValue: '5.0.0',
            remoteValue: '6.0.0',
        },
        ...overrides,
    };
}

beforeEach(() => {
    jest.restoreAllMocks();
    mockedAccess.mockReset().mockResolvedValue(undefined);
    mockedReadFile.mockReset().mockResolvedValue(composeYaml);
    mockedWriteFile.mockReset().mockResolvedValue(undefined);
    mockedCopyFile.mockReset().mockResolvedValue(undefined);
    dockercompose.configuration = { ...baseConfiguration };
});

test('getComposeFileForContainer should return the absolute label path', () => {
    const container = buildContainer({
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    expect(dockercompose.getComposeFileForContainer(container)).toBe(
        '/abs/docker-compose.yml',
    );
});

test('getComposeFileForContainer should fall back to the configuration file', () => {
    const container = buildContainer();
    expect(dockercompose.getComposeFileForContainer(container)).toBe(
        '/default/docker-compose.yml',
    );
});

test('getComposeFileForContainer should resolve a relative label path to absolute', () => {
    const container = buildContainer({
        labels: { 'wud.compose.file': 'relative/docker-compose.yml' },
    });
    expect(dockercompose.getComposeFileForContainer(container)).toBe(
        path.resolve('relative/docker-compose.yml'),
    );
});

test('groupByComposeFile should skip a non-local-host container', async () => {
    const container = buildContainer({
        watcher: 'remote',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const groups = await dockercompose.groupByComposeFile([container]);
    expect(groups.size).toBe(0);
});

test('groupByComposeFile should skip a container whose compose file is missing', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    const container = buildContainer({
        labels: { 'wud.compose.file': '/missing/docker-compose.yml' },
    });
    const groups = await dockercompose.groupByComposeFile([container]);
    expect(groups.size).toBe(0);
});

test('groupByComposeFile should group belonging containers and drop non-belonging ones', async () => {
    const c1 = buildContainer({
        id: 'c1',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const c2 = buildContainer({
        id: 'c2',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const other = buildContainer({
        id: 'c3',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
        image: {
            id: 'image-id-nginx',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'library/nginx',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
    });
    const groups = await dockercompose.groupByComposeFile([c1, c2, other]);
    expect(groups.size).toBe(1);
    expect(groups.get('/abs/docker-compose.yml')).toHaveLength(2);
});

test('mapCurrentVersionToUpdateVersion should return the current and update image strings', () => {
    const compose = {
        services: { svc: { image: 'ghcr.io/stefanprodan/podinfo:5.0.0' } },
    };
    const result = dockercompose.mapCurrentVersionToUpdateVersion(
        compose,
        buildContainer(),
    );
    expect(result).toEqual({
        current: 'ghcr.io/stefanprodan/podinfo:5.0.0',
        update: 'ghcr.io/stefanprodan/podinfo:6.0.0',
    });
});

test('mapCurrentVersionToUpdateVersion should return undefined and warn when no service matches', () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    const compose = { services: { svc: { image: 'nginx:1.0.0' } } };
    const result = dockercompose.mapCurrentVersionToUpdateVersion(
        compose,
        buildContainer(),
    );
    expect(result).toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
});

test('rewriteComposeFile should write the file with versions replaced', async () => {
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer({ id: 'c1' }),
        buildContainer({ id: 'c2' }),
    ]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [file, data] = mockedWriteFile.mock.calls[0];
    expect(file).toBe('/abs/docker-compose.yml');
    expect(data).toContain('ghcr.io/stefanprodan/podinfo:6.0.0');
    expect(data).not.toContain('5.0.0');
});

test('rewriteComposeFile should write a backup copy when backup is enabled', async () => {
    dockercompose.configuration = { ...baseConfiguration, backup: true };
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer(),
    ]);
    expect(mockedCopyFile).toHaveBeenCalledWith(
        '/abs/docker-compose.yml',
        '/abs/docker-compose.yml.back',
    );
});

test('rewriteComposeFile should not write a backup copy when backup is disabled', async () => {
    dockercompose.configuration = { ...baseConfiguration, backup: false };
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer(),
    ]);
    expect(mockedCopyFile).not.toHaveBeenCalled();
});

test('triggerBatch should pull all, then rewrite, then swap (ordering)', async () => {
    const order: string[] = [];
    const c1 = buildContainer({ id: 'c1' });
    const c2 = buildContainer({ id: 'c2' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [c1, c2]]]),
    );
    jest.spyOn(dockercompose, 'pullContainer').mockImplementation(async () => {
        order.push('pull');
        return {} as ContainerUpdateContext;
    });
    jest.spyOn(dockercompose, 'writeComposeFile').mockImplementation(
        async () => {
            order.push('write');
        },
    );
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(async () => {
        order.push('swap');
    });
    await dockercompose.triggerBatch([c1, c2]);
    expect(order).toEqual(['pull', 'pull', 'write', 'swap', 'swap']);
});

test('triggerBatch should abort before any write or swap when a pull rejects', async () => {
    const c1 = buildContainer({ id: 'c1' });
    const bad = buildContainer({ id: 'bad' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [c1, bad]]]),
    );
    jest.spyOn(dockercompose, 'pullContainer').mockImplementation(
        async (container) => {
            if (container.id === 'bad') {
                throw new Error('pull failed');
            }
            return {} as ContainerUpdateContext;
        },
    );
    const writeSpy = jest
        .spyOn(dockercompose, 'writeComposeFile')
        .mockResolvedValue(undefined);
    const swapSpy = jest
        .spyOn(dockercompose, 'swapContainer')
        .mockResolvedValue(undefined);
    await expect(dockercompose.triggerBatch([c1, bad])).rejects.toThrow(
        'pull failed',
    );
    expect(writeSpy).not.toHaveBeenCalled();
    expect(swapSpy).not.toHaveBeenCalled();
});

test('triggerBatch should pull but not rewrite or swap under dry-run', async () => {
    dockercompose.configuration = { ...baseConfiguration, dryrun: true };
    const c1 = buildContainer({ id: 'c1' });
    const c2 = buildContainer({ id: 'c2' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [c1, c2]]]),
    );
    const pullSpy = jest
        .spyOn(dockercompose, 'pullContainer')
        .mockResolvedValue({} as ContainerUpdateContext);
    const writeSpy = jest
        .spyOn(dockercompose, 'writeComposeFile')
        .mockResolvedValue(undefined);
    const swapSpy = jest
        .spyOn(dockercompose, 'swapContainer')
        .mockResolvedValue(undefined);
    await dockercompose.triggerBatch([c1, c2]);
    expect(pullSpy).toHaveBeenCalledTimes(2);
    expect(writeSpy).not.toHaveBeenCalled();
    expect(swapSpy).not.toHaveBeenCalled();
});

test('writeComposeFile should rethrow when the write fails', async () => {
    mockedWriteFile.mockRejectedValue(new Error('EROFS'));
    await expect(
        dockercompose.writeComposeFile('/abs/docker-compose.yml', 'data'),
    ).rejects.toThrow('EROFS');
});

test('triggerBatch should abort before any swap when a compose write fails', async () => {
    const c1 = buildContainer({ id: 'c1' });
    const c2 = buildContainer({ id: 'c2' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [c1, c2]]]),
    );
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    mockedWriteFile.mockRejectedValue(new Error('EROFS'));
    const swapSpy = jest
        .spyOn(dockercompose, 'swapContainer')
        .mockResolvedValue(undefined);
    await expect(dockercompose.triggerBatch([c1, c2])).rejects.toThrow('EROFS');
    expect(swapSpy).not.toHaveBeenCalled();
});

test('triggerBatch should swap only the containers whose pull returned a context', async () => {
    const live = buildContainer({ id: 'live' });
    const gone = buildContainer({ id: 'gone' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [live, gone]]]),
    );
    jest.spyOn(dockercompose, 'pullContainer').mockImplementation(async (c) =>
        c.id === 'gone' ? undefined : ({} as ContainerUpdateContext),
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue(
        undefined,
    );
    const swapSpy = jest
        .spyOn(dockercompose, 'swapContainer')
        .mockResolvedValue(undefined);
    await dockercompose.triggerBatch([live, gone]);
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy.mock.calls[0][0]).toBe(live);
});

test('doesContainerBelongToCompose should match a service whose image contains the container image', () => {
    const compose = {
        services: {
            podinfo: { image: 'ghcr.io/stefanprodan/podinfo:5.0.0' },
            builder: { build: '.' },
        },
    };
    expect(doesContainerBelongToCompose(compose, buildContainer())).toBe(true);
});

test('doesContainerBelongToCompose should return false without throwing when a service has no image', () => {
    const compose = {
        services: {
            builder: { build: '.' },
            other: { image: 'something/else:1.0.0' },
        },
    };
    expect(() =>
        doesContainerBelongToCompose(compose, buildContainer()),
    ).not.toThrow();
    expect(doesContainerBelongToCompose(compose, buildContainer())).toBe(false);
});

test('getUnbatchableContainers should return containers that do not belong to a compose file', async () => {
    const belongs = buildContainer({
        id: 'c1',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const foreign = buildContainer({
        id: 'c2',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
        image: {
            id: 'image-id-nginx',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'library/nginx',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
    });
    const result = await dockercompose.getUnbatchableContainers([
        belongs,
        foreign,
    ]);
    expect(result).toEqual([foreign]);
});

test('getUnbatchableContainers should return an empty array when all containers belong', async () => {
    const c1 = buildContainer({
        id: 'c1',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const c2 = buildContainer({
        id: 'c2',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const result = await dockercompose.getUnbatchableContainers([c1, c2]);
    expect(result).toEqual([]);
});
