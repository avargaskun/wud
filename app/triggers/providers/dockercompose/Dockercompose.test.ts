import path from 'path';
import fs from 'fs/promises';
import { Scalar } from 'yaml';
import Dockercompose, {
    doesContainerBelongToCompose,
    canonicalizeImageRef,
    imageRefsMatch,
    getCurrentImageRef,
    buildUpdatedImageRef,
    renderScalarValue,
    applyComposeEdits,
} from './Dockercompose';
import type { ComposeEdit } from './Dockercompose';
import log from '../../../log';
import { Container } from '../../../model/container';
import type {
    ContainerUpdateContext,
    DependentOutcome,
    SwapOutcome,
} from '../docker/types';

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

/**
 * Typed view on the protected post-update helpers inherited from Docker.
 */
interface ProtectedDockerApi {
    runPostUpdate(
        swaps: SwapOutcome[],
        memberNames: Set<string>,
    ): Promise<DependentOutcome[]>;
}
const protectedApi = dockercompose as unknown as ProtectedDockerApi;

function buildSwapOutcome(container: Container): SwapOutcome {
    return {
        container,
        success: true,
        newContainerId: `new-${container.id}`,
        startedAfterSwap: true,
        oldContainerId: container.id,
    };
}

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
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(
        async (container) => {
            order.push('swap');
            return buildSwapOutcome(container);
        },
    );
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
        .mockImplementation(async (container) => buildSwapOutcome(container));
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
        .mockImplementation(async (container) => buildSwapOutcome(container));
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
        .mockImplementation(async (container) => buildSwapOutcome(container));
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
        .mockImplementation(async (container) => buildSwapOutcome(container));
    const result = await dockercompose.triggerBatch([live, gone]);
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy.mock.calls[0][0]).toBe(live);
    expect(result?.members).toEqual([
        { id: 'live', name: 'zz_batch_compose_1', status: 'updated' },
        {
            id: 'gone',
            name: 'zz_batch_compose_1',
            status: 'failed',
            error: 'Container no longer exists',
        },
    ]);
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

test('triggerBatch should run the post-update epilogue once, after every swap, with the filtered member set', async () => {
    const order: string[] = [];
    const c1 = buildContainer({ id: 'c1', name: 'zz_batch_compose_1' });
    const c2 = buildContainer({ id: 'c2', name: 'zz_batch_compose_2' });
    const foreign = buildContainer({ id: 'c3', name: 'not_in_compose' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [c1, c2]]]),
    );
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue(
        undefined,
    );
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(
        async (container) => {
            order.push('swap');
            return buildSwapOutcome(container);
        },
    );
    const postUpdateSpy = jest
        .spyOn(protectedApi, 'runPostUpdate')
        .mockImplementation(async () => {
            order.push('postupdate');
            return [
                {
                    name: 'dep',
                    host: 'zz_batch_compose_1',
                    status: 'bounced',
                    method: 'restart',
                },
            ];
        });

    const result = await dockercompose.triggerBatch([c1, c2, foreign]);

    expect(order).toEqual(['swap', 'swap', 'postupdate']);
    expect(postUpdateSpy).toHaveBeenCalledTimes(1);
    const [swaps, memberNames] = postUpdateSpy.mock.calls[0];
    expect(swaps.map((swap) => swap.container.id)).toEqual(['c1', 'c2']);
    expect(memberNames).toEqual(
        new Set(['zz_batch_compose_1', 'zz_batch_compose_2']),
    );
    expect(result).toEqual({
        members: [
            { id: 'c1', name: 'zz_batch_compose_1', status: 'updated' },
            { id: 'c2', name: 'zz_batch_compose_2', status: 'updated' },
        ],
        dependents: [
            {
                name: 'dep',
                host: 'zz_batch_compose_1',
                status: 'bounced',
                method: 'restart',
            },
        ],
    });
});

test('triggerBatch should report a failed member without aborting the epilogue', async () => {
    const good = buildContainer({ id: 'good', name: 'zz_batch_compose_1' });
    const bad = buildContainer({ id: 'bad', name: 'zz_batch_compose_2' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map([['/abs/docker-compose.yml', [good, bad]]]),
    );
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue(
        undefined,
    );
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(
        async (container) => {
            if (container.id === 'bad') {
                throw new Error('swap failed');
            }
            return buildSwapOutcome(container);
        },
    );
    const postUpdateSpy = jest
        .spyOn(protectedApi, 'runPostUpdate')
        .mockResolvedValue([]);

    const result = await dockercompose.triggerBatch([good, bad]);

    expect(postUpdateSpy).toHaveBeenCalledTimes(1);
    expect(result?.members).toEqual([
        { id: 'good', name: 'zz_batch_compose_1', status: 'updated' },
        {
            id: 'bad',
            name: 'zz_batch_compose_2',
            status: 'failed',
            error: 'swap failed',
        },
    ]);
});

test('triggerBatch should return void and skip the epilogue when no container is batchable', async () => {
    const foreign = buildContainer({ id: 'c1', name: 'not_in_compose' });
    jest.spyOn(dockercompose, 'groupByComposeFile').mockResolvedValue(
        new Map(),
    );
    const postUpdateSpy = jest.spyOn(protectedApi, 'runPostUpdate');
    await expect(
        dockercompose.triggerBatch([foreign]),
    ).resolves.toBeUndefined();
    expect(postUpdateSpy).not.toHaveBeenCalled();
});

test('trigger should throw when the sole batch member failed', async () => {
    const container = buildContainer({ id: 'c1' });
    jest.spyOn(dockercompose, 'triggerBatch').mockResolvedValue({
        members: [
            {
                id: 'c1',
                name: 'zz_batch_compose_1',
                status: 'failed',
                error: 'swap failed',
            },
        ],
        dependents: [],
    });
    await expect(dockercompose.trigger(container)).rejects.toThrow(
        'swap failed',
    );
});

test('trigger should return the batch result when the sole member was updated', async () => {
    const container = buildContainer({ id: 'c1' });
    const batchResult = {
        members: [
            {
                id: 'c1',
                name: 'zz_batch_compose_1',
                status: 'updated' as const,
            },
        ],
        dependents: [
            {
                name: 'dep',
                host: 'zz_batch_compose_1',
                status: 'bounced' as const,
                method: 'restart' as const,
            },
        ],
    };
    jest.spyOn(dockercompose, 'triggerBatch').mockResolvedValue(batchResult);
    await expect(dockercompose.trigger(container)).resolves.toEqual(
        batchResult,
    );
});

test.each([
    ['docker.io/library/nginx:1.0', 'nginx:1.0'],
    ['index.docker.io/library/nginx:1.0', 'nginx:1.0'],
    ['library/nginx:1.0', 'nginx:1.0'],
    ['nginx:1.0', 'nginx:1.0'],
    ['ghcr.io/x/y:1.0', 'ghcr.io/x/y:1.0'],
])('canonicalizeImageRef should canonicalize %s to %s', (input, expected) => {
    expect(canonicalizeImageRef(input)).toBe(expected);
});

test('canonicalizeImageRef should not strip library from a 3 segment path', () => {
    expect(canonicalizeImageRef('ghcr.io/library/x:1.0')).toBe(
        'ghcr.io/library/x:1.0',
    );
});

test('canonicalizeImageRef should not add an implicit latest tag', () => {
    expect(canonicalizeImageRef('nginx')).toBe('nginx');
});

test('imageRefsMatch should not match a longer tag with the same prefix', () => {
    expect(
        imageRefsMatch(
            'ghcr.io/stefanprodan/podinfo:5.0.00',
            'ghcr.io/stefanprodan/podinfo:5.0.0',
        ),
    ).toBe(false);
});

test('imageRefsMatch should not match a combined tag and digest pin', () => {
    expect(
        imageRefsMatch(
            'ghcr.io/stefanprodan/podinfo:5.0.0@sha256:x',
            'ghcr.io/stefanprodan/podinfo:5.0.0',
        ),
    ).toBe(false);
});

test('imageRefsMatch should match the short and long hub forms', () => {
    expect(imageRefsMatch('docker.io/library/nginx:1.25', 'nginx:1.25')).toBe(
        true,
    );
});

test('buildUpdatedImageRef should return undefined for a digest pin', () => {
    expect(
        buildUpdatedImageRef(
            'ghcr.io/stefanprodan/podinfo@sha256:abc',
            '6.0.0',
        ),
    ).toBeUndefined();
});

test('buildUpdatedImageRef should return undefined for an interpolated ref', () => {
    expect(
        buildUpdatedImageRef(
            'ghcr.io/stefanprodan/podinfo:${PODINFO_TAG}',
            '6.0.0',
        ),
    ).toBeUndefined();
});

test('buildUpdatedImageRef should return undefined for an untagged repo', () => {
    expect(buildUpdatedImageRef('nginx', '1.1')).toBeUndefined();
});

test('buildUpdatedImageRef should return undefined for a registry port without a tag', () => {
    expect(buildUpdatedImageRef('host:5000/repo', '1.1')).toBeUndefined();
});

test('buildUpdatedImageRef should swap the tag and keep the rest of the ref', () => {
    expect(buildUpdatedImageRef('docker.io/library/nginx:1.0', '1.1')).toBe(
        'docker.io/library/nginx:1.1',
    );
    expect(buildUpdatedImageRef('host:5000/repo:1.0', '1.1')).toBe(
        'host:5000/repo:1.1',
    );
});

test('renderScalarValue should render a double quoted scalar', () => {
    expect(renderScalarValue('nginx:1.1', Scalar.QUOTE_DOUBLE)).toBe(
        '"nginx:1.1"',
    );
});

test('renderScalarValue should render a single quoted scalar and double its quotes', () => {
    expect(renderScalarValue('nginx:1.1', Scalar.QUOTE_SINGLE)).toBe(
        "'nginx:1.1'",
    );
    expect(renderScalarValue("ngi'nx:1.1", Scalar.QUOTE_SINGLE)).toBe(
        "'ngi''nx:1.1'",
    );
});

test('renderScalarValue should render a plain scalar as is', () => {
    expect(renderScalarValue('nginx:1.1', Scalar.PLAIN)).toBe('nginx:1.1');
    expect(renderScalarValue('nginx:1.1', undefined)).toBe('nginx:1.1');
});

test('renderScalarValue should return undefined for a block scalar', () => {
    expect(
        renderScalarValue('nginx:1.1', Scalar.BLOCK_LITERAL),
    ).toBeUndefined();
});

test('renderScalarValue should return undefined for an unsafe plain value', () => {
    expect(renderScalarValue('nginx:1.1 #x', Scalar.PLAIN)).toBeUndefined();
});

test('applyComposeEdits should splice regardless of the input order', () => {
    const source = '0123456789ABCDEFGHIJ';
    const edits: ComposeEdit[] = [
        {
            serviceName: 'a',
            start: 2,
            end: 4,
            text: 'XX',
            from: '23',
            to: 'XX',
        },
        {
            serviceName: 'b',
            start: 8,
            end: 10,
            text: 'Y',
            from: '89',
            to: 'Y',
        },
        {
            serviceName: 'c',
            start: 12,
            end: 16,
            text: 'ZZZZZZ',
            from: 'CDEF',
            to: 'ZZZZZZ',
        },
    ];
    const ascending = applyComposeEdits(source, edits);
    const descending = applyComposeEdits(source, [...edits].reverse());
    expect(ascending).toBe('01XX4567YABZZZZZZGHIJ');
    expect(descending).toBe(ascending);
});

test('applyComposeEdits should throw on overlapping ranges', () => {
    const edits: ComposeEdit[] = [
        {
            serviceName: 'a',
            start: 2,
            end: 6,
            text: 'X',
            from: '2345',
            to: 'X',
        },
        {
            serviceName: 'b',
            start: 4,
            end: 8,
            text: 'Y',
            from: '4567',
            to: 'Y',
        },
    ];
    expect(() => applyComposeEdits('0123456789', edits)).toThrow(
        'Overlapping compose edits for service a at 2-6',
    );
});

test('getCurrentImageRef should return undefined for an unknown registry', () => {
    const container = buildContainer({
        image: {
            id: 'image-id',
            registry: { name: 'unknown', url: 'ghcr.io' },
            name: 'stefanprodan/podinfo',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
    });
    expect(getCurrentImageRef(container)).toBeUndefined();
});

test('getCurrentImageRef should return the registry normalized ref', () => {
    expect(getCurrentImageRef(buildContainer())).toBe(
        'ghcr.io/stefanprodan/podinfo:5.0.0',
    );
});
