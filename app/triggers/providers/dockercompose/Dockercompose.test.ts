import path from 'path';
import fs from 'fs/promises';
import { Scalar } from 'yaml';
import Dockercompose, {
    doesContainerBelongToCompose,
    resolveComposeServiceName,
    canonicalizeImageRef,
    imageRefsMatch,
    isMirrorPrefixedRef,
    getCurrentImageRef,
    buildUpdatedImageRef,
    renderScalarValue,
    applyComposeEdits,
} from './Dockercompose';
import type { ComposeEdit, ComposeFile } from './Dockercompose';
import { ContainerGoneError } from '../docker/errors';
import log from '../../../log';
import { Container } from '../../../model/container';
import type {
    ContainerUpdateContext,
    DependentOutcome,
    SwapOutcome,
} from '../docker/types';
import { emptyHints } from '../docker/config';

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

const composeYamlRich = `# top comment
x-common: &base
  image: ghcr.io/stefanprodan/podinfo:5.0.0
services:
  svc_plain:
    image: ghcr.io/stefanprodan/podinfo:5.0.0   # keep this comment
  svc_twin:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
  svc_quoted:
    image: "ghcr.io/stefanprodan/podinfo:5.0.0"
  svc_single:
    image: 'nginx:1.25'
  svc_prefix:
    image: ghcr.io/stefanprodan/podinfo:5.0.00
  svc_interpolated:
    image: ghcr.io/stefanprodan/podinfo:\${PODINFO_TAG}
  svc_digest:
    image: ghcr.io/stefanprodan/podinfo@sha256:abc123
  svc_anchor:
    image: &shared_img ghcr.io/stefanprodan/podinfo:4.0.0
  svc_alias:
    image: *shared_img
  svc_inherits:
    <<: *base
    container_name: svc_inherits
  svc_build:
    build: .
`;

const composeYamlSingleService = `services:
  zz_batch_compose_1:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
`;

const composeYamlCrlf = composeYamlSingleService.replace(/\n/g, '\r\n');

const composeYamlBom = `\uFEFF${composeYamlSingleService}`;

const composeYamlTabs = 'services:\n\ta:\n\t\timage: nginx:1.0\n';

const composeYamlPrefixOnly = `services:
  only_prefix:
    image: ghcr.io/stefanprodan/podinfo:5.0.00
`;

const composeYamlDigestCombined = `services:
  only_digest:
    image: ghcr.io/stefanprodan/podinfo:5.0.0@sha256:abc123
`;

const composeYamlForeign = `services:
  other:
    image: docker.io/library/nginx:1.0
`;

const composeYamlAliasBomb = `services:
  bomb:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
x-a0: &a0 ['x', 'x']
x-a1: &a1 [*a0, *a0]
x-a2: &a2 [*a1, *a1]
x-a3: &a3 [*a2, *a2]
x-a4: &a4 [*a3, *a3]
x-a5: &a5 [*a4, *a4]
x-a6: &a6 [*a5, *a5]
x-a7: &a7 [*a6, *a6]
`;

const composeYamlCascade = `services:
  svc_a:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
  svc_b:
    image: ghcr.io/stefanprodan/podinfo:6.0.0
`;

const composeYamlCascadeExpected = `services:
  svc_a:
    image: ghcr.io/stefanprodan/podinfo:6.0.0
  svc_b:
    image: ghcr.io/stefanprodan/podinfo:6.1.0
`;

const composeYamlMirror = `services:
  svc_mirror:
    image: mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0
  svc_upstream:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
`;

const composeYamlMirrorOnly = `services:
  svc_mirror:
    image: mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0
`;

const composeYamlTwoMirrors = `services:
  svc_mirror_a:
    image: mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0
  svc_mirror_b:
    image: cache.local:5000/ghcr.io/stefanprodan/podinfo:5.0.0
`;

const composeYamlHubCoarse = `services:
  svc_own:
    image: ghcr.io/acme/other:\${OTHER_TAG}
  svc_other:
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
    swapAll(
        containers: Container[],
        contexts: (ContainerUpdateContext | undefined)[],
    ): Promise<SwapOutcome[]>;
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

type ContainerOverrides = Partial<Omit<Container, 'labels'>> & {
    labels?: Container['labels'] | null;
};

function buildContainer(overrides: ContainerOverrides = {}): Container {
    const { labels, ...rest } = overrides;
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
        labels:
            labels === null
                ? {}
                : {
                      'com.docker.compose.service': 'zz_batch_compose_1',
                      ...labels,
                  },
        ...rest,
    };
}

const singleQuoted = buildContainer({
    id: 'c-single',
    labels: null,
    image: {
        id: 'img-nginx',
        registry: { name: 'hub', url: 'docker.io' },
        name: 'library/nginx',
        tag: { value: '1.25', semver: true },
        digest: { watch: false },
        architecture: 'amd64',
        os: 'linux',
    },
    updateKind: { kind: 'tag', localValue: '1.25', remoteValue: '1.26' },
});

function buildAnchorContainer(label: string | null): Container {
    return buildContainer({
        id: 'c-anchor',
        labels: label === null ? null : { 'com.docker.compose.service': label },
        image: {
            id: 'img-anchor',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'stefanprodan/podinfo',
            tag: { value: '4.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
        updateKind: { kind: 'tag', localValue: '4.0.0', remoteValue: '4.1.0' },
    });
}

function buildCascadeContainers(): [Container, Container] {
    return [
        buildContainer({
            id: 'c-cascade-a',
            labels: { 'com.docker.compose.service': 'svc_a' },
        }),
        buildContainer({
            id: 'c-cascade-b',
            labels: { 'com.docker.compose.service': 'svc_b' },
            image: {
                id: 'img-cascade-b',
                registry: { name: 'hub', url: 'ghcr.io' },
                name: 'stefanprodan/podinfo',
                tag: { value: '6.0.0', semver: true },
                digest: { watch: false },
                architecture: 'amd64',
                os: 'linux',
            },
            updateKind: {
                kind: 'tag',
                localValue: '6.0.0',
                remoteValue: '6.1.0',
            },
        }),
    ];
}

async function loadRichCompose(): Promise<ComposeFile> {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    return dockercompose.getComposeFileAsObject('/abs/docker-compose.yml');
}

beforeEach(() => {
    jest.restoreAllMocks();
    mockedAccess.mockReset().mockResolvedValue(undefined);
    mockedReadFile.mockReset().mockResolvedValue(composeYaml);
    mockedWriteFile.mockReset().mockResolvedValue(undefined);
    mockedCopyFile.mockReset().mockResolvedValue(undefined);
    dockercompose.configuration = { ...baseConfiguration };
});

test('initTrigger should accept a configured file list when at least one exists', async () => {
    dockercompose.configuration.file = '/abs/a.yml,/abs/b.yml';
    mockedAccess.mockImplementation(async (file: string) => {
        if (file === '/abs/b.yml') {
            return undefined;
        }
        throw new Error('missing');
    });
    const warn = jest.spyOn(dockercompose.log, 'warn');

    await expect(dockercompose.initTrigger()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
        'The default file /abs/a.yml does not exist',
    );
});

test('initTrigger should reject when no configured file exists', async () => {
    dockercompose.configuration.file = '/abs/a.yml,/abs/b.yml';
    mockedAccess.mockRejectedValue(new Error('missing'));

    await expect(dockercompose.initTrigger()).rejects.toThrow(
        'The default file /abs/a.yml,/abs/b.yml does not exist',
    );
});

test('getComposeFilesForContainer should return the absolute label path', () => {
    const container = buildContainer({
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([
        '/abs/docker-compose.yml',
    ]);
});

test('getComposeFilesForContainer should resolve a relative label path to absolute', () => {
    const container = buildContainer({
        labels: { 'wud.compose.file': 'relative/docker-compose.yml' },
    });
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([
        path.resolve('relative/docker-compose.yml'),
    ]);
});

test('getComposeFilesForContainer should split a comma-separated label value', () => {
    const container = buildContainer({
        labels: {
            'wud.compose.file': '/abs/docker-compose.yml,relative/override.yml',
        },
    });
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([
        '/abs/docker-compose.yml',
        path.resolve('relative/override.yml'),
    ]);
});

test('getComposeFilesForContainer should trim and drop empty config_files segments', () => {
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files': ' /a.yml , ,/b.yml,',
        },
    });
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([
        '/a.yml',
        '/b.yml',
    ]);
});

test('getComposeFilesForContainer should prefer the wud label over config_files', () => {
    const container = buildContainer({
        labels: {
            'wud.compose.file': '/abs/docker-compose.yml',
            'com.docker.compose.project.config_files': '/a.yml,/b.yml',
        },
    });
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([
        '/abs/docker-compose.yml',
    ]);
});

test('getComposeFilesForContainer should fall back to the configuration file', () => {
    const container = buildContainer();
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([
        '/default/docker-compose.yml',
    ]);
});

test('getComposeFilesForContainer should return an empty array without label or configured file', () => {
    dockercompose.configuration = { ...baseConfiguration, file: undefined };
    const container = buildContainer();
    expect(dockercompose.getComposeFilesForContainer(container)).toEqual([]);
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

test('resolveComposeFileForContainer should pick the last candidate that declares the image', async () => {
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/base.yml,/abs/override.yml',
        },
    });
    await expect(
        dockercompose.resolveComposeFileForContainer(container, new Map()),
    ).resolves.toMatchObject({ file: '/abs/override.yml' });
});

test('resolveComposeFileForContainer should pick the only candidate that declares the image', async () => {
    mockedReadFile.mockImplementation(async (file: string) =>
        file === '/abs/override.yml' ? composeYamlForeign : composeYaml,
    );
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/base.yml,/abs/override.yml',
        },
    });
    await expect(
        dockercompose.resolveComposeFileForContainer(container, new Map()),
    ).resolves.toMatchObject({ file: '/abs/base.yml' });
});

test('resolveComposeFileForContainer should skip a candidate that does not exist', async () => {
    mockedAccess.mockImplementation(async (file: string) => {
        if (file === '/abs/missing.yml') {
            throw new Error('missing');
        }
    });
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/missing.yml,/abs/base.yml',
        },
    });
    await expect(
        dockercompose.resolveComposeFileForContainer(container, new Map()),
    ).resolves.toMatchObject({ file: '/abs/base.yml' });
});

test('resolveComposeFileForContainer should warn and skip an unparseable candidate', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockImplementation(async (file: string) =>
        file === '/abs/broken.yml' ? composeYamlTabs : composeYaml,
    );
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/broken.yml,/abs/base.yml',
        },
    });
    await expect(
        dockercompose.resolveComposeFileForContainer(container, new Map()),
    ).resolves.toMatchObject({ file: '/abs/base.yml' });
    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
            'Skipping compose file /abs/broken.yml for container zz_batch_compose_1',
        ),
    );
});

test('classifyContainers should read each distinct candidate once', async () => {
    const containers = ['c1', 'c2', 'c3'].map((id) =>
        buildContainer({
            id,
            labels: {
                'com.docker.compose.project.config_files':
                    '/abs/base.yml,/abs/override.yml',
            },
        }),
    );
    const { groups, unprocessable } =
        await dockercompose.classifyContainers(containers);
    expect(unprocessable).toEqual([]);
    expect(groups.get('/abs/override.yml')).toHaveLength(3);
    expect(mockedReadFile.mock.calls.length).toBe(2);
});

test('classifyContainers should group two containers of the same project together', async () => {
    const c1 = buildContainer({
        id: 'c1',
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/base.yml,/abs/override.yml',
        },
    });
    const c2 = buildContainer({
        id: 'c2',
        labels: {
            'com.docker.compose.service': 'zz_batch_compose_2',
            'com.docker.compose.project.config_files':
                ' /abs/base.yml , /abs/override.yml ',
        },
    });
    const { groups } = await dockercompose.classifyContainers([c1, c2]);
    expect(groups.size).toBe(1);
    expect(groups.get('/abs/override.yml')).toEqual([c1, c2]);
});

test('classifyContainers should reject a non-local-host container with a reason', async () => {
    const container = buildContainer({
        watcher: 'remote',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const { groups, unprocessable } = await dockercompose.classifyContainers([
        container,
    ]);
    expect(groups.size).toBe(0);
    expect(unprocessable).toEqual([
        { container, reason: 'it is not running on the local host' },
    ]);
});

test('classifyContainers should name both labels when there is no candidate', async () => {
    dockercompose.configuration = { ...baseConfiguration, file: undefined };
    const container = buildContainer({ labels: null });
    const { unprocessable } = await dockercompose.classifyContainers([
        container,
    ]);
    expect(unprocessable[0].container).toBe(container);
    expect(unprocessable[0].reason).toContain("no 'wud.compose.file' label");
    expect(unprocessable[0].reason).toContain(
        "no 'com.docker.compose.project.config_files' label",
    );
});

test('classifyContainers should list the candidates when none of them exists', async () => {
    mockedAccess.mockRejectedValue(new Error('missing'));
    const container = buildContainer({
        labels: { 'wud.compose.file': '/abs/a.yml,/abs/b.yml' },
    });
    const { unprocessable } = await dockercompose.classifyContainers([
        container,
    ]);
    expect(unprocessable[0].reason).toBe(
        'none of its candidate compose files exist (/abs/a.yml, /abs/b.yml)',
    );
});

test('classifyContainers should list the existing candidates when none declares the image', async () => {
    mockedReadFile.mockResolvedValue(composeYamlForeign);
    const container = buildContainer({
        labels: { 'wud.compose.file': '/abs/a.yml,/abs/b.yml' },
    });
    const { unprocessable } = await dockercompose.classifyContainers([
        container,
    ]);
    expect(unprocessable[0].reason).toBe(
        'no service in /abs/a.yml, /abs/b.yml pins its image ghcr.io/stefanprodan/podinfo:5.0.0',
    );
});

test('classifyContainers should report a parse failure rather than a service mismatch', async () => {
    mockedReadFile.mockResolvedValue(composeYamlTabs);
    const container = buildContainer({
        labels: { 'wud.compose.file': '/abs/a.yml,/abs/b.yml' },
    });
    const { unprocessable } = await dockercompose.classifyContainers([
        container,
    ]);
    expect(unprocessable[0].reason).toBe(
        'none of its candidate compose files could be read or parsed (/abs/a.yml, /abs/b.yml)',
    );
});

test('classifyContainers should warn when a container matches no service', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlForeign);
    const container = buildContainer({
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    await dockercompose.classifyContainers([container]);
    expect(warnSpy).toHaveBeenCalledWith(
        'Cannot update container zz_batch_compose_1 because no service in /abs/docker-compose.yml pins its image ghcr.io/stefanprodan/podinfo:5.0.0',
    );
});

test('classifyContainers should report nothing unprocessable when every container resolves', async () => {
    const c1 = buildContainer({
        id: 'c1',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const c2 = buildContainer({
        id: 'c2',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const { groups, unprocessable } = await dockercompose.classifyContainers([
        c1,
        c2,
    ]);
    expect(unprocessable).toEqual([]);
    expect(groups.get('/abs/docker-compose.yml')).toEqual([c1, c2]);
});

test('rewriteComposeFile should bump only the labelled service and leave its twin untouched', async () => {
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer({ id: 'c1' }),
        buildContainer({ id: 'c2' }),
    ]);
    const expected = composeYaml.replace(
        'zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:5.0.0',
        'zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:6.0.0',
    );
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [file, data] = mockedWriteFile.mock.calls[0];
    expect(file).toBe('/abs/docker-compose.yml');
    expect(data).toBe(expected);
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [c1, c2]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [c1, bad]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [c1, c2]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [c1, c2]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [live, gone]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
    jest.spyOn(dockercompose, 'pullContainer').mockImplementation(async (c) =>
        c.id === 'gone' ? undefined : ({} as ContainerUpdateContext),
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue({
        editedIds: new Set<string>(),
        staleIds: new Set<string>(),
    });
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
            error: 'Container zz_batch_compose_1 no longer exists',
            gone: true,
        },
    ]);
});

test('doesContainerBelongToCompose should match the service whose image equals the container image', () => {
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

test('getUnprocessableContainers should return containers that do not belong to a compose file', async () => {
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
    const result = await dockercompose.getUnprocessableContainers([
        belongs,
        foreign,
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].container).toBe(foreign);
    expect(result[0].reason).toMatch(/pins its image/);
});

test('getUnprocessableContainers should return an empty array when all containers belong', async () => {
    const c1 = buildContainer({
        id: 'c1',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const c2 = buildContainer({
        id: 'c2',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const result = await dockercompose.getUnprocessableContainers([c1, c2]);
    expect(result).toEqual([]);
});

test('triggerBatch should run the post-update epilogue once, after every swap, with the filtered member set', async () => {
    const order: string[] = [];
    const c1 = buildContainer({ id: 'c1', name: 'zz_batch_compose_1' });
    const c2 = buildContainer({ id: 'c2', name: 'zz_batch_compose_2' });
    const foreign = buildContainer({ id: 'c3', name: 'not_in_compose' });
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [c1, c2]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue({
        editedIds: new Set<string>(),
        staleIds: new Set<string>(),
    });
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([['/abs/docker-compose.yml', [good, bad]]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue({
        editedIds: new Set<string>(),
        staleIds: new Set<string>(),
    });
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
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map(),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
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

test('trigger should throw with the resolution reason when the container is unprocessable', async () => {
    const container = buildContainer({
        id: 'c1',
        labels: { 'wud.compose.file': '/missing/docker-compose.yml' },
    });
    mockedAccess.mockRejectedValue(new Error('ENOENT'));
    await expect(dockercompose.trigger(container)).rejects.toThrow(
        'Container zz_batch_compose_1 was not updated by this trigger (none of its candidate compose files exist (/missing/docker-compose.yml))',
    );
});

test('trigger should not throw under dryrun when triggerBatch returns void', async () => {
    dockercompose.configuration = { ...baseConfiguration, dryrun: true };
    const container = buildContainer({ id: 'c1' });
    jest.spyOn(dockercompose, 'triggerBatch').mockResolvedValue(undefined);
    await expect(dockercompose.trigger(container)).resolves.toBeUndefined();
});

test('trigger should throw ContainerGoneError when the sole member is gone', async () => {
    const container = buildContainer({ id: 'c1' });
    jest.spyOn(dockercompose, 'triggerBatch').mockResolvedValue({
        members: [
            {
                id: 'c1',
                name: 'zz_batch_compose_1',
                status: 'failed',
                error: 'Container zz_batch_compose_1 no longer exists',
                gone: true,
            },
        ],
        dependents: [],
    });
    await expect(dockercompose.trigger(container)).rejects.toBeInstanceOf(
        ContainerGoneError,
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

test.each<[string, string, boolean]>([
    [
        'mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        true,
    ],
    [
        'mirror.local:5000/ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        true,
    ],
    [
        'localhost:5000/ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        true,
    ],
    [
        'harbor.local/proxy/ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        true,
    ],
    ['mirror.local/library/nginx:1.25', 'nginx:1.25', true],
    ['ghcr.io/stefanprodan/podinfo:5.0.0', 'stefanprodan/podinfo:5.0.0', true],
    ['quay.io/nginx:1.25', 'nginx:1.25', true],
    [
        'xghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        false,
    ],
    [
        'mirror.local/ghcr.io/stefanprodan/podinfo:5.0.00',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        false,
    ],
    [
        'myorg/ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        false,
    ],
    [
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        false,
    ],
    [
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        'mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0',
        false,
    ],
    [
        '/ghcr.io/stefanprodan/podinfo:5.0.0',
        'ghcr.io/stefanprodan/podinfo:5.0.0',
        false,
    ],
])(
    'isMirrorPrefixedRef should judge file %s against computed %s as %s',
    (fileRef, computedRef, expected) => {
        expect(isMirrorPrefixedRef(fileRef, computedRef)).toBe(expected);
    },
);

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

test('resolveComposeServiceName should let the label pick among services sharing a pin', async () => {
    const compose = await loadRichCompose();
    const container = buildContainer({
        labels: { 'com.docker.compose.service': 'svc_twin' },
    });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_twin',
        source: 'label',
    });
});

test('resolveComposeServiceName should return ambiguous for a label-less container with duplicate pins', async () => {
    const compose = await loadRichCompose();
    const container = buildContainer({ labels: null });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'ambiguous',
        candidates: ['svc_plain', 'svc_twin', 'svc_quoted'],
    });
});

test('resolveComposeServiceName should match the file short hub form through canonicalization', async () => {
    const compose = await loadRichCompose();
    expect(
        resolveComposeServiceName(
            compose,
            singleQuoted,
            getCurrentImageRef(singleQuoted),
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_single',
        source: 'image',
    });
});

test('resolveComposeServiceName should ignore a label naming a service that is not a candidate', async () => {
    const compose = await loadRichCompose();
    const container = buildContainer({
        labels: { 'com.docker.compose.service': 'svc_prefix' },
    });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'ambiguous',
        candidates: ['svc_plain', 'svc_twin', 'svc_quoted'],
    });
});

test('resolveComposeServiceName should ignore a label naming a service absent from the file', async () => {
    const compose = await loadRichCompose();
    const container = buildContainer({
        ...singleQuoted,
        labels: { 'com.docker.compose.service': 'ghost_service' },
    });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_single',
        source: 'image',
    });
});

test.each(['constructor', 'toString', 'hasOwnProperty', 'valueOf'])(
    'resolveComposeServiceName should return not-found for the prototype label %s',
    (label) => {
        const compose: ComposeFile = {
            services: { other: { image: 'nginx:1.0.0' } },
        };
        const container = buildContainer({
            labels: { 'com.docker.compose.service': label },
        });
        expect(
            resolveComposeServiceName(
                compose,
                container,
                getCurrentImageRef(container),
            ),
        ).toEqual({ status: 'not-found' });
    },
);

test('resolveComposeServiceName should return not-found without throwing when services is undefined', () => {
    const container = buildContainer();
    expect(() =>
        resolveComposeServiceName(
            {} as ComposeFile,
            container,
            getCurrentImageRef(container),
        ),
    ).not.toThrow();
    expect(
        resolveComposeServiceName(
            {} as ComposeFile,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({ status: 'not-found' });
});

test('resolveComposeServiceName should resolve a label-less container against a lone mirror pin', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirrorOnly);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({ labels: null });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_mirror',
        source: 'image',
    });
});

test('resolveComposeServiceName should let the label pick a mirror pin over a unique exact pin', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirror);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        labels: { 'com.docker.compose.service': 'svc_mirror' },
    });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_mirror',
        source: 'label',
    });
});

test('resolveComposeServiceName should prefer a unique exact pin over a mirror pin without a label', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirror);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({ labels: null });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_upstream',
        source: 'image',
    });
});

test('resolveComposeServiceName should return ambiguous for a label-less container with two mirror pins', async () => {
    mockedReadFile.mockResolvedValue(composeYamlTwoMirrors);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({ labels: null });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            getCurrentImageRef(container),
        ),
    ).toEqual({
        status: 'ambiguous',
        candidates: ['svc_mirror_a', 'svc_mirror_b'],
    });
});

test('resolveComposeServiceName should return not-found when the label names another service than the lone mirror candidate', async () => {
    mockedReadFile.mockResolvedValue(composeYamlHubCoarse);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        labels: { 'com.docker.compose.service': 'svc_own' },
    });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            'stefanprodan/podinfo:5.0.0',
        ),
    ).toEqual({ status: 'not-found' });
});

test('resolveComposeServiceName should resolve a label-less hub container against a same-named registry pin', async () => {
    mockedReadFile.mockResolvedValue(composeYamlHubCoarse);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({ labels: null });
    expect(
        resolveComposeServiceName(
            compose,
            container,
            'stefanprodan/podinfo:5.0.0',
        ),
    ).toEqual({
        status: 'resolved',
        serviceName: 'svc_other',
        source: 'image',
    });
});

test('doesContainerBelongToCompose should return true for an ambiguous container', async () => {
    const compose = await loadRichCompose();
    expect(
        doesContainerBelongToCompose(compose, buildContainer({ labels: null })),
    ).toBe(true);
});

test('doesContainerBelongToCompose should return true for a mirror-pinned container', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirrorOnly);
    const compose = await dockercompose.getComposeFileAsObject(
        '/abs/docker-compose.yml',
    );
    expect(
        doesContainerBelongToCompose(compose, buildContainer({ labels: null })),
    ).toBe(true);
});

test('getUnprocessableContainers should return an empty array for a mirror-pinned container', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirrorOnly);
    const container = buildContainer({ id: 'c-mirror', labels: null });
    await expect(
        dockercompose.getUnprocessableContainers([container]),
    ).resolves.toEqual([]);
});

test('getUnprocessableContainers should return an empty array for an ambiguous container', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const container = buildContainer({ id: 'c1', labels: null });
    await expect(
        dockercompose.getUnprocessableContainers([container]),
    ).resolves.toEqual([]);
});

test('getUnprocessableContainers should return a container whose only compose pin is a longer tag', async () => {
    mockedReadFile.mockResolvedValue(composeYamlPrefixOnly);
    const container = buildContainer({ id: 'c1' });
    const result = await dockercompose.getUnprocessableContainers([container]);
    expect(result).toHaveLength(1);
    expect(result[0].container).toBe(container);
    expect(result[0].reason).toMatch(/pins its image/);
});

test('getUnprocessableContainers should return a container whose only compose pin combines a tag and a digest', async () => {
    mockedReadFile.mockResolvedValue(composeYamlDigestCombined);
    const container = buildContainer({ id: 'c1' });
    const result = await dockercompose.getUnprocessableContainers([container]);
    expect(result).toHaveLength(1);
    expect(result[0].container).toBe(container);
    expect(result[0].reason).toMatch(/pins its image/);
});

test('getUnprocessableContainers should return a container with an unknown registry without throwing', async () => {
    mockedReadFile.mockResolvedValue(composeYaml);
    const container = buildContainer({
        id: 'c1',
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
    const result = await dockercompose.getUnprocessableContainers([container]);
    expect(result).toHaveLength(1);
    expect(result[0].container).toBe(container);
    expect(result[0].reason).toMatch(/pins its image/);
});

test('groupByComposeFile should keep an ambiguous container in its group', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const container = buildContainer({ id: 'c1', labels: null });
    const groups = await dockercompose.groupByComposeFile([container]);
    expect(groups.get('/default/docker-compose.yml')).toEqual([container]);
});

test('loadComposeFile should materialize a chained anchor bomb the default limit rejects', async () => {
    mockedReadFile.mockResolvedValue(composeYamlAliasBomb);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    expect(loaded.compose.services.bomb.image).toBe(
        'ghcr.io/stefanprodan/podinfo:5.0.0',
    );
    expect(() => loaded.doc.toJS()).toThrow('Excessive alias count');
});

test('loadComposeFile should log and rethrow when materializing the document fails', async () => {
    const errorSpy = jest.spyOn(dockercompose.log, 'error');
    mockedReadFile.mockResolvedValue('services:\n  a:\n    image: *nope\n');
    await expect(
        dockercompose.loadComposeFile('/abs/docker-compose.yml'),
    ).rejects.toThrow('Unresolved alias');
    expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
            'Error when parsing the docker-compose yaml file /abs/docker-compose.yml',
        ),
    );
});

test('loadComposeFile should log and rethrow when the compose file cannot be read', async () => {
    const errorSpy = jest.spyOn(dockercompose.log, 'error');
    mockedReadFile.mockRejectedValue(
        new Error('ENOENT: no such file or directory'),
    );
    await expect(
        dockercompose.loadComposeFile('/abs/docker-compose.yml'),
    ).rejects.toThrow('ENOENT: no such file or directory');
    expect(errorSpy).toHaveBeenCalledWith(
        'Error when reading the docker-compose yaml file /abs/docker-compose.yml (ENOENT: no such file or directory)',
    );
});

test('getComposeFileAsObject should return empty services for an empty file', async () => {
    mockedReadFile.mockResolvedValue('');
    await expect(
        dockercompose.getComposeFileAsObject('/abs/docker-compose.yml'),
    ).resolves.toEqual({ services: {} });
});

test('getComposeFileAsObject should drop top level keys other than services', async () => {
    mockedReadFile.mockResolvedValue(
        "version: '3'\nvolumes:\n  data: {}\nservices:\n  a:\n    image: nginx:1.0\n",
    );
    await expect(
        dockercompose.getComposeFileAsObject('/abs/docker-compose.yml'),
    ).resolves.toEqual({ services: { a: { image: 'nginx:1.0' } } });
});

test('groupByComposeFile should read each compose file once', async () => {
    const containers = ['c1', 'c2', 'c3'].map((id) =>
        buildContainer({
            id,
            labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
        }),
    );
    const groups = await dockercompose.groupByComposeFile(containers);
    expect(groups.get('/abs/docker-compose.yml')).toHaveLength(3);
    expect(mockedReadFile.mock.calls.length).toBe(1);
});

test('planComposeEdits should plan a single edit for the labelled service', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        id: 'c-twin',
        labels: { 'com.docker.compose.service': 'svc_twin' },
    });
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toHaveLength(1);
    expect(edits[0].serviceName).toBe('svc_twin');
    expect(loaded.source.slice(edits[0].start, edits[0].end)).toBe(
        'ghcr.io/stefanprodan/podinfo:5.0.0',
    );
    expect(edits[0].text).toBe('ghcr.io/stefanprodan/podinfo:6.0.0');
    expect([...editedIds]).toEqual(['c-twin']);
    expect([...staleIds]).toEqual([]);
});

test('planComposeEdits should keep the mirror prefix when bumping the labelled mirror service', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirror);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        id: 'c-mirror',
        labels: { 'com.docker.compose.service': 'svc_mirror' },
    });
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toHaveLength(1);
    expect(edits[0].serviceName).toBe('svc_mirror');
    expect(loaded.source.slice(edits[0].start, edits[0].end)).toBe(
        'mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0',
    );
    expect(edits[0].text).toBe(
        'mirror.local/ghcr.io/stefanprodan/podinfo:6.0.0',
    );
    expect([...editedIds]).toEqual(['c-mirror']);
    expect([...staleIds]).toEqual([]);
});

test('rewriteComposeFile should bump the mirror pin and leave the exact-pinned bystander untouched', async () => {
    mockedReadFile.mockResolvedValue(composeYamlMirror);
    const container = buildContainer({
        id: 'c-mirror',
        labels: { 'com.docker.compose.service': 'svc_mirror' },
    });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        container,
    ]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [, data] = mockedWriteFile.mock.calls[0];
    expect(data).toBe(
        composeYamlMirror.replace(
            'image: mirror.local/ghcr.io/stefanprodan/podinfo:5.0.0',
            'image: mirror.local/ghcr.io/stefanprodan/podinfo:6.0.0',
        ),
    );
    expect(data).toContain(
        '  svc_upstream:\n    image: ghcr.io/stefanprodan/podinfo:5.0.0\n',
    );
});

test('planComposeEdits should put a digest update in neither set', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        id: 'c-digest',
        labels: { 'com.docker.compose.service': 'svc_twin' },
        updateKind: {
            kind: 'digest',
            localValue: 'sha256:aaa',
            remoteValue: 'sha256:bbb',
        },
    });
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect(editedIds.has('c-digest')).toBe(false);
    expect(staleIds.has('c-digest')).toBe(false);
});

test('planComposeEdits should describe a container without an update kind as unknown', async () => {
    const debugSpy = jest.spyOn(dockercompose.log, 'debug');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        id: 'c-no-kind',
        labels: { 'com.docker.compose.service': 'svc_twin' },
        updateKind: undefined,
    });
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect(editedIds.has('c-no-kind')).toBe(false);
    expect(staleIds.has('c-no-kind')).toBe(false);
    expect(debugSpy).toHaveBeenCalledWith(
        'Skipping zz_batch_compose_1: unknown update does not change the compose image',
    );
});

test('planComposeEdits should mark an ambiguous container stale and name every candidate', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({ id: 'c-ambiguous', labels: null });
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect([...staleIds]).toEqual(['c-ambiguous']);
    expect([...editedIds]).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('svc_plain, svc_twin, svc_quoted'),
    );
});

test('planComposeEdits should mark a container matching no service stale', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        id: 'c-foreign',
        labels: null,
        image: {
            id: 'img-foreign',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'library/nginx',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
    });
    const { edits, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect([...staleIds]).toEqual(['c-foreign']);
    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Could not find a service for container'),
    );
});

test('planComposeEdits should refuse to edit an anchored image scalar', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildAnchorContainer('svc_anchor');
    const { edits, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect([...staleIds]).toEqual(['c-anchor']);
    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("anchors its image as '&shared_img'"),
    );
});

test('planComposeEdits should refuse to edit an aliased image scalar', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildAnchorContainer('svc_alias');
    const { edits, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect([...staleIds]).toEqual(['c-anchor']);
});

test('planComposeEdits should plan one edit for two containers of the same service', async () => {
    const debugSpy = jest.spyOn(dockercompose.log, 'debug');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const containers = ['c1', 'c2'].map((id) =>
        buildContainer({
            id,
            labels: { 'com.docker.compose.service': 'svc_twin' },
        }),
    );
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        containers,
        '/abs/docker-compose.yml',
    );
    expect(edits).toHaveLength(1);
    expect([...editedIds]).toEqual(['c1', 'c2']);
    expect([...staleIds]).toEqual([]);
    expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Service svc_twin already planned'),
    );
});

test('planComposeEdits should count a service already on the new tag as edited', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const loaded = await dockercompose.loadComposeFile(
        '/abs/docker-compose.yml',
    );
    const container = buildContainer({
        id: 'c-current',
        labels: { 'com.docker.compose.service': 'svc_twin' },
        updateKind: {
            kind: 'tag',
            localValue: '5.0.0',
            remoteValue: '5.0.0',
        },
    });
    const { edits, editedIds, staleIds } = dockercompose.planComposeEdits(
        loaded,
        [container],
        '/abs/docker-compose.yml',
    );
    expect(edits).toEqual([]);
    expect([...editedIds]).toEqual(['c-current']);
    expect([...staleIds]).toEqual([]);
});

test('rewriteComposeFile should bump only the labelled service in a rich compose file', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const container = buildContainer({
        id: 'c-twin',
        labels: { 'com.docker.compose.service': 'svc_twin' },
    });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        container,
    ]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [file, data] = mockedWriteFile.mock.calls[0];
    expect(file).toBe('/abs/docker-compose.yml');
    expect(data).toBe(
        composeYamlRich.replace(
            '  svc_twin:\n    image: ghcr.io/stefanprodan/podinfo:5.0.0\n',
            '  svc_twin:\n    image: ghcr.io/stefanprodan/podinfo:6.0.0\n',
        ),
    );
});

test('rewriteComposeFile should write nothing and warn for a label-less container matching several services', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const container = buildContainer({ id: 'c-ambiguous', labels: null });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        container,
    ]);
    expect(mockedWriteFile).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('svc_plain, svc_twin, svc_quoted'),
    );
});

test('rewriteComposeFile should preserve the double-quoted image style', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const container = buildContainer({
        id: 'c-quoted',
        labels: { 'com.docker.compose.service': 'svc_quoted' },
    });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        container,
    ]);
    const [, data] = mockedWriteFile.mock.calls[0];
    expect(data).toContain('image: "ghcr.io/stefanprodan/podinfo:6.0.0"');
});

test('rewriteComposeFile should preserve the single-quoted style and the short hub form', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        singleQuoted,
    ]);
    const [, data] = mockedWriteFile.mock.calls[0];
    expect(data).toContain("    image: 'nginx:1.26'");
    expect(data).not.toContain('docker.io/library/nginx:1.26');
});

test('rewriteComposeFile should skip a service whose image scalar is anchored', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildAnchorContainer('svc_anchor'),
    ]);
    expect(mockedWriteFile).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("anchors its image as '&shared_img'"),
    );
});

test('rewriteComposeFile should skip a service whose image is an alias', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildAnchorContainer('svc_alias'),
    ]);
    expect(mockedWriteFile).not.toHaveBeenCalled();
});

test('rewriteComposeFile should neither write nor backup for a digest update', async () => {
    dockercompose.configuration = { ...baseConfiguration, backup: true };
    const container = buildContainer({
        id: 'c-digest',
        updateKind: {
            kind: 'digest',
            localValue: 'sha256:aaa',
            remoteValue: 'sha256:bbb',
        },
    });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        container,
    ]);
    expect(mockedWriteFile).not.toHaveBeenCalled();
    expect(mockedCopyFile).not.toHaveBeenCalled();
});

test('rewriteComposeFile should take the backup before the write', async () => {
    dockercompose.configuration = { ...baseConfiguration, backup: true };
    const order: string[] = [];
    mockedCopyFile.mockImplementation(async () => {
        order.push('copy');
    });
    mockedWriteFile.mockImplementation(async () => {
        order.push('write');
    });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer(),
    ]);
    expect(order).toEqual(['copy', 'write']);
});

test('rewriteComposeFile should preserve CRLF line endings', async () => {
    mockedReadFile.mockResolvedValue(Buffer.from(composeYamlCrlf));
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer(),
    ]);
    const [, data] = mockedWriteFile.mock.calls[0];
    expect(data).toContain('\r\n');
    expect(data).toBe(
        composeYamlCrlf.replace('podinfo:5.0.0', 'podinfo:6.0.0'),
    );
});

test('rewriteComposeFile should preserve a leading byte order mark', async () => {
    mockedReadFile.mockResolvedValue(Buffer.from(composeYamlBom));
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        buildContainer(),
    ]);
    const [, data] = mockedWriteFile.mock.calls[0];
    expect(data).toMatch(/^\uFEFF/);
    expect(data).toBe(composeYamlBom.replace('podinfo:5.0.0', 'podinfo:6.0.0'));
});

test('rewriteComposeFile should reject tab-indented yaml without writing', async () => {
    mockedReadFile.mockResolvedValue(composeYamlTabs);
    await expect(
        dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
            buildContainer(),
        ]),
    ).rejects.toThrow('Tabs are not allowed as indentation');
    expect(mockedWriteFile).not.toHaveBeenCalled();
});

test('rewriteComposeFile should let the first container win for a scaled service', async () => {
    const debugSpy = jest.spyOn(dockercompose.log, 'debug');
    const first = buildContainer({ id: 'c1' });
    const second = buildContainer({
        id: 'c2',
        updateKind: { kind: 'tag', localValue: '5.0.0', remoteValue: '6.1.0' },
    });
    await dockercompose.rewriteComposeFile('/abs/docker-compose.yml', [
        first,
        second,
    ]);
    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    const [, data] = mockedWriteFile.mock.calls[0];
    expect(data).toBe(
        composeYaml.replace(
            'zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:5.0.0',
            'zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:6.0.0',
        ),
    );
    expect(debugSpy).toHaveBeenCalledWith(
        expect.stringContaining('Service zz_batch_compose_1 already planned'),
    );
});

test.each([false, true])(
    'rewriteComposeFile should bump two services with overlapping tags without cascading (reversed order: %s)',
    async (reversed: boolean) => {
        mockedReadFile.mockResolvedValue(composeYamlCascade);
        const containers = buildCascadeContainers();
        await dockercompose.rewriteComposeFile(
            '/abs/docker-compose.yml',
            reversed ? [containers[1], containers[0]] : containers,
        );
        expect(mockedWriteFile).toHaveBeenCalledTimes(1);
        const data: string = mockedWriteFile.mock.calls[0][1] as string;
        expect(data).toBe(composeYamlCascadeExpected);
    },
);

test('groupByComposeFile should drop a container matching no service in the file', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const member = buildContainer({
        id: 'c-member',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
    });
    const foreign = buildContainer({
        id: 'c-foreign',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
        image: {
            id: 'img-foreign',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'library/nginx',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
    });
    const groups = await dockercompose.groupByComposeFile([member, foreign]);
    expect(groups.get('/abs/docker-compose.yml')).toEqual([member]);
});

test('groupByComposeFile should warn when it drops a non-belonging container', async () => {
    const warnSpy = jest.spyOn(dockercompose.log, 'warn');
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const foreign = buildContainer({
        id: 'c-foreign',
        name: 'zz_foreign',
        labels: { 'wud.compose.file': '/abs/docker-compose.yml' },
        image: {
            id: 'img-foreign',
            registry: { name: 'hub', url: 'ghcr.io' },
            name: 'library/nginx',
            tag: { value: '5.0.0', semver: true },
            digest: { watch: false },
            architecture: 'amd64',
            os: 'linux',
        },
    });
    const groups = await dockercompose.groupByComposeFile([foreign]);
    expect(groups.size).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(
        'Cannot update container zz_foreign because no service in /abs/docker-compose.yml pins its image ghcr.io/library/nginx:5.0.0',
    );
});

test('triggerBatch should pull and swap a container whose group planned no edit', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    const container = buildContainer({ id: 'c-ambiguous', labels: null });
    const pullSpy = jest
        .spyOn(dockercompose, 'pullContainer')
        .mockResolvedValue({} as ContainerUpdateContext);
    const writeSpy = jest
        .spyOn(dockercompose, 'writeComposeFile')
        .mockResolvedValue(undefined);
    const swapSpy = jest
        .spyOn(dockercompose, 'swapContainer')
        .mockImplementation(async (swapped) => buildSwapOutcome(swapped));
    await dockercompose.triggerBatch([container]);
    expect(pullSpy).toHaveBeenCalledTimes(1);
    expect(swapSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).not.toHaveBeenCalled();
});

test('triggerBatch should read the compose file exactly twice for one file', async () => {
    const c1 = buildContainer({ id: 'c1' });
    const c2 = buildContainer({ id: 'c2' });
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'writeComposeFile').mockResolvedValue(undefined);
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(
        async (swapped) => buildSwapOutcome(swapped),
    );
    await dockercompose.triggerBatch([c1, c2]);
    expect(mockedReadFile).toHaveBeenCalledTimes(2);
});

function stubPullAndSwap(): void {
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'writeComposeFile').mockResolvedValue(undefined);
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(
        async (swapped) => buildSwapOutcome(swapped),
    );
}

test('triggerBatch should report fileUpdated false for an ambiguous member', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    stubPullAndSwap();
    const container = buildContainer({ id: 'c-ambiguous', labels: null });
    const result = await dockercompose.triggerBatch([container]);
    expect(result.members).toEqual([
        {
            id: 'c-ambiguous',
            name: 'zz_batch_compose_1',
            status: 'updated',
            fileUpdated: false,
        },
    ]);
});

test('triggerBatch should report fileUpdated true for a spliced member', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    stubPullAndSwap();
    const container = buildContainer({
        id: 'c-twin',
        labels: { 'com.docker.compose.service': 'svc_twin' },
    });
    const result = await dockercompose.triggerBatch([container]);
    expect(result.members).toEqual([
        {
            id: 'c-twin',
            name: 'zz_batch_compose_1',
            status: 'updated',
            fileUpdated: true,
        },
    ]);
});

test('triggerBatch should omit fileUpdated for a digest member', async () => {
    stubPullAndSwap();
    const container = buildContainer({
        id: 'c-digest',
        updateKind: {
            kind: 'digest',
            localValue: 'sha256:aaa',
            remoteValue: 'sha256:bbb',
        },
    });
    const result = await dockercompose.triggerBatch([container]);
    expect('fileUpdated' in result.members[0]).toBe(false);
    expect(result.members[0].status).toBe('updated');
});

test('triggerBatch should union the outcomes of two compose files', async () => {
    mockedReadFile.mockImplementation(async () => composeYamlRich);
    stubPullAndSwap();
    const stale = buildContainer({ id: 'c-stale', labels: null });
    const edited = buildContainer({
        id: 'c-edited',
        labels: {
            'com.docker.compose.service': 'svc_twin',
            'wud.compose.file': '/abs/b.yml',
        },
    });
    const result = await dockercompose.triggerBatch([stale, edited]);
    const byId = new Map(result.members.map((member) => [member.id, member]));
    expect(byId.get('c-stale').fileUpdated).toBe(false);
    expect(byId.get('c-edited').fileUpdated).toBe(true);
});

test('triggerBatch should report fileUpdated true for both containers of a scaled service', async () => {
    stubPullAndSwap();
    const first = buildContainer({ id: 'c1' });
    const second = buildContainer({ id: 'c2' });
    const result = await dockercompose.triggerBatch([first, second]);
    expect(result.members.map((member) => member.fileUpdated)).toEqual([
        true,
        true,
    ]);
});

test('triggerBatch should annotate by container id when two members share a name', async () => {
    mockedReadFile.mockResolvedValue(composeYamlRich);
    stubPullAndSwap();
    const stale = buildContainer({ id: 'c-stale', name: 'dup', labels: null });
    const edited = buildContainer({
        id: 'c-edited',
        name: 'dup',
        labels: { 'com.docker.compose.service': 'svc_twin' },
    });
    const result = await dockercompose.triggerBatch([stale, edited]);
    const byId = new Map(result.members.map((member) => [member.id, member]));
    expect(byId.get('c-stale').fileUpdated).toBe(false);
    expect(byId.get('c-edited').fileUpdated).toBe(true);
});

const bumpedFirst = composeYaml.replace(
    'zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:5.0.0',
    'zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:6.0.0',
);

const bumpedBoth = bumpedFirst.replace(
    'zz_batch_compose_2:\n    image: ghcr.io/stefanprodan/podinfo:5.0.0',
    'zz_batch_compose_2:\n    image: ghcr.io/stefanprodan/podinfo:6.0.0',
);

const composeFilePath = '/abs/docker-compose.yml';

function stubBatchWithFailedSwaps(
    containers: Container[],
    failedIds: string[],
): void {
    const failed = new Set(failedIds);
    jest.spyOn(dockercompose, 'classifyContainers').mockResolvedValue({
        groups: new Map([[composeFilePath, containers]]),
        unprocessable: [],
        hintsByContainerId: new Map(),
    });
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'swapContainer').mockImplementation(
        async (container: Container) => {
            if (failed.has(container.id)) {
                throw new Error('swap failed');
            }
            return buildSwapOutcome(container);
        },
    );
}

test('triggerBatch should revert the compose image line when every container on it failed', async () => {
    const container = buildContainer({ id: 'c-failed' });
    mockedReadFile
        .mockReset()
        .mockResolvedValueOnce(composeYaml)
        .mockResolvedValueOnce(bumpedFirst);
    stubBatchWithFailedSwaps([container], ['c-failed']);

    const result = await dockercompose.triggerBatch([container]);

    expect(mockedWriteFile).toHaveBeenCalledTimes(2);
    expect(mockedWriteFile.mock.calls[0]).toEqual([
        composeFilePath,
        bumpedFirst,
    ]);
    expect(mockedWriteFile.mock.calls[1]).toEqual([
        composeFilePath,
        composeYaml,
    ]);
    expect(result?.members).toEqual([
        {
            id: 'c-failed',
            name: 'zz_batch_compose_1',
            status: 'failed',
            error: 'swap failed',
            fileUpdated: false,
        },
    ]);
});

test('triggerBatch should keep the bumped line when one container of a scaled service succeeded', async () => {
    const first = buildContainer({ id: 'c1' });
    const second = buildContainer({ id: 'c2' });
    mockedReadFile.mockReset().mockResolvedValue(composeYaml);
    stubBatchWithFailedSwaps([first, second], ['c2']);

    const result = await dockercompose.triggerBatch([first, second]);

    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    expect(mockedWriteFile.mock.calls[0][1]).toBe(bumpedFirst);
    const byId = new Map(result.members.map((member) => [member.id, member]));
    expect(byId.get('c1').status).toBe('updated');
    expect(byId.get('c1').fileUpdated).toBe(true);
});

test('triggerBatch should revert only the failed service line of a mixed compose file', async () => {
    const good = buildContainer({ id: 'c-good' });
    const bad = buildContainer({
        id: 'c-bad',
        name: 'zz_batch_compose_2',
        labels: { 'com.docker.compose.service': 'zz_batch_compose_2' },
    });
    mockedReadFile
        .mockReset()
        .mockResolvedValueOnce(composeYaml)
        .mockResolvedValueOnce(bumpedBoth);
    stubBatchWithFailedSwaps([good, bad], ['c-bad']);

    const result = await dockercompose.triggerBatch([good, bad]);

    expect(mockedWriteFile).toHaveBeenCalledTimes(2);
    expect(mockedWriteFile.mock.calls[0][1]).toBe(bumpedBoth);
    expect(mockedWriteFile.mock.calls[1][1]).toBe(bumpedFirst);
    const byId = new Map(result.members.map((member) => [member.id, member]));
    expect(byId.get('c-good').fileUpdated).toBe(true);
    expect(byId.get('c-bad').fileUpdated).toBe(false);
});

test('triggerBatch should not revert a compose file that changed on disk since the rewrite', async () => {
    const container = buildContainer({ id: 'c-failed' });
    mockedReadFile
        .mockReset()
        .mockResolvedValueOnce(composeYaml)
        .mockResolvedValueOnce(
            'services:\n  zz_batch_compose_1:\n    image: ghcr.io/stefanprodan/podinfo:9.9.9\n',
        );
    const warn = jest.spyOn(dockercompose.log, 'warn');
    stubBatchWithFailedSwaps([container], ['c-failed']);

    const result = await dockercompose.triggerBatch([container]);

    expect(mockedWriteFile).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
        `${composeFilePath} changed on disk since the rewrite, not reverting`,
    );
    expect(result.members[0].fileUpdated).toBe(true);
});

const composeYamlHintBase = `services:
  zz_batch_compose_1:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
    environment:
      - TZ=UTC
      - PUID=1000
`;

const composeYamlHintOverride = `services:
  zz_batch_compose_1:
    labels:
      - 'org.opencontainers.image.version=5.0.0'
    command: ['./podinfo', '--level=debug']
`;

const composeYamlHintImageMatch = `services:
  zz_batch_compose_1:
    image: ghcr.io/stefanprodan/podinfo:5.0.0
    environment:
      TZ: UTC
    user: app
`;

test('classifyContainers should union the hints of every candidate compose file', async () => {
    mockedReadFile.mockImplementation(async (file: string) =>
        file === '/abs/override.yml'
            ? composeYamlHintOverride
            : composeYamlHintBase,
    );
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/base.yml,/abs/override.yml',
        },
    });

    const { hintsByContainerId } = await dockercompose.classifyContainers([
        container,
    ]);

    const hints = hintsByContainerId.get(container.id);
    expect(hints).toBeDefined();
    expect([...hints!.envKeys].sort()).toEqual(['PUID', 'TZ']);
    expect([...hints!.labelKeys]).toEqual(['org.opencontainers.image.version']);
    expect([...hints!.fields]).toEqual(['Cmd']);
});

test('classifyContainers should ignore a candidate that cannot be parsed', async () => {
    mockedReadFile.mockImplementation(async (file: string) =>
        file === '/abs/broken.yml' ? composeYamlTabs : composeYamlHintBase,
    );
    const container = buildContainer({
        labels: {
            'com.docker.compose.project.config_files':
                '/abs/broken.yml,/abs/base.yml',
        },
    });

    const { hintsByContainerId } = await dockercompose.classifyContainers([
        container,
    ]);

    const hints = hintsByContainerId.get(container.id);
    expect([...hints!.envKeys].sort()).toEqual(['PUID', 'TZ']);
    expect([...hints!.labelKeys]).toEqual([]);
});

test('classifyContainers should hint a container without a service label through the image match', async () => {
    mockedReadFile.mockResolvedValue(composeYamlHintImageMatch);
    const container = buildContainer({ labels: null });

    const { hintsByContainerId } = await dockercompose.classifyContainers([
        container,
    ]);

    const hints = hintsByContainerId.get(container.id);
    expect([...hints!.envKeys]).toEqual(['TZ']);
    expect([...hints!.fields]).toEqual(['User']);
});

test('classifyContainers should return empty hints when the file declares nothing', async () => {
    const container = buildContainer();

    const { hintsByContainerId } = await dockercompose.classifyContainers([
        container,
    ]);

    expect(hintsByContainerId.get(container.id)).toEqual(emptyHints());
});

test('triggerBatch should attach the collected hints to every context before swapping', async () => {
    mockedReadFile.mockResolvedValue(composeYamlHintBase);
    const container = buildContainer({ id: 'c1' });
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(
        {} as ContainerUpdateContext,
    );
    jest.spyOn(dockercompose, 'rewriteComposeFile').mockResolvedValue({
        editedIds: new Set<string>(),
        staleIds: new Set<string>(),
    });
    const swapAllSpy = jest
        .spyOn(protectedApi, 'swapAll')
        .mockResolvedValue([]);
    jest.spyOn(protectedApi, 'runPostUpdate').mockResolvedValue([]);

    await dockercompose.triggerBatch([container]);

    expect(swapAllSpy).toHaveBeenCalledTimes(1);
    const contexts = swapAllSpy.mock.calls[0][1];
    expect([...contexts[0]!.userConfigHints!.envKeys].sort()).toEqual([
        'PUID',
        'TZ',
    ]);
});

test('triggerBatch should refresh com.docker.compose.image through the real swap', async () => {
    const container = buildContainer({ id: 'c1', name: 'zz_batch_compose_1' });
    const createContainer = jest.fn(async () => ({
        id: 'new-id',
        start: jest.fn().mockResolvedValue(undefined),
    }));
    const ctx = {
        dockerApi: { createContainer },
        registry: {
            getImageFullName: () => 'ghcr.io/stefanprodan/podinfo:6.0.0',
        },
        newImage: 'ghcr.io/stefanprodan/podinfo:6.0.0',
        currentContainer: {
            stop: jest.fn().mockResolvedValue(undefined),
            rename: jest.fn().mockResolvedValue(undefined),
            remove: jest.fn().mockResolvedValue(undefined),
            wait: jest.fn().mockResolvedValue(undefined),
        },
        currentContainerSpec: {
            Name: '/zz_batch_compose_1',
            Id: 'c1',
            HostConfig: {},
            NetworkSettings: { Networks: {} },
            State: { Running: true },
            Config: {
                Labels: {
                    'com.docker.compose.image': 'sha256:old',
                    'com.docker.compose.service': 'zz_batch_compose_1',
                },
            },
        },
        state: { Running: true },
        currentImageSpec: { Id: 'sha256:old', Config: { Labels: {} } },
        newImageId: 'sha256:new',
    } as unknown as ContainerUpdateContext;
    jest.spyOn(dockercompose, 'pullContainer').mockResolvedValue(ctx);
    jest.spyOn(dockercompose, 'writeComposeFile').mockResolvedValue(undefined);
    jest.spyOn(protectedApi, 'runPostUpdate').mockResolvedValue([]);
    const createSpy = jest.spyOn(dockercompose, 'createContainer');

    const result = await dockercompose.triggerBatch([container]);

    expect(result?.members?.[0]?.status).toBe('updated');
    expect(createSpy).toHaveBeenCalled();
    expect(createSpy.mock.calls[0][1].Labels['com.docker.compose.image']).toBe(
        'sha256:new',
    );
});
