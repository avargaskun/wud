// @ts-nocheck
import fs from 'fs';
import os from 'os';
import path from 'path';
import log from '../log';
import * as tagcache from '../tagcache';

jest.mock('axios');
jest.mock('../prometheus/registry', () => ({
    getSummaryTags: () => ({
        observe: () => {},
    }),
    getRetryCounter: () => undefined,
}));

import Registry from './Registry';

const registry = new Registry();
registry.register('registry', 'hub', 'test', {});

test('base64Encode should decode credentials', async () => {
    expect(Registry.base64Encode('username', 'password')).toEqual(
        'dXNlcm5hbWU6cGFzc3dvcmQ=',
    );
});

test('getId should return registry type only', async () => {
    expect(registry.getId()).toStrictEqual('hub.test');
});

test('match should return false when not overridden', async () => {
    expect(registry.match('')).toBeFalsy();
});

test('normalizeImage should return same image when not overridden', async () => {
    expect(registry.normalizeImage({ x: 'x' })).toStrictEqual({ x: 'x' });
});

test('authenticate should return same request options when not overridden', async () => {
    expect(registry.authenticate({}, { x: 'x' })).resolves.toStrictEqual({
        x: 'x',
    });
});

test('getTags should sort tags z -> a', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    registryMocked.callRegistry = () => ({
        headers: {},
        data: { tags: ['v1', 'v2', 'v3'] },
    });
    expect(
        registryMocked.getTags({ name: 'test', registry: { url: 'test' } }),
    ).resolves.toStrictEqual(['v3', 'v2', 'v1']);
});

describe('getTags caching and dedupe', () => {
    const image = { name: 'test', registry: { url: 'test' } };

    class IncrementalRegistry extends Registry {
        supportsIncrementalTagListing() {
            return true;
        }
    }

    beforeEach(async () => {
        await tagcache.init({ enabled: false });
    });

    const buildRegistry = () => {
        const registryMocked = new Registry();
        registryMocked.log = log;
        return registryMocked;
    };

    const tagsPage = () => ({
        headers: {},
        data: { tags: ['v1', 'v2', 'v3'] },
    });

    test('concurrent calls for the same image should issue a single crawl', async () => {
        const registryMocked = buildRegistry();
        registryMocked.getTagsPage = jest
            .fn()
            .mockImplementation(async () => tagsPage());
        const results = await Promise.all([
            registryMocked.getTags(image),
            registryMocked.getTags(image),
        ]);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(1);
        expect(results[0]).toStrictEqual(['v3', 'v2', 'v1']);
        expect(results[1]).toStrictEqual(['v3', 'v2', 'v1']);
    });

    test('concurrent calls for different images should issue two crawls', async () => {
        const registryMocked = buildRegistry();
        registryMocked.getTagsPage = jest
            .fn()
            .mockImplementation(async () => tagsPage());
        await Promise.all([
            registryMocked.getTags(image),
            registryMocked.getTags({
                name: 'other',
                registry: { url: 'test' },
            }),
        ]);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(2);
    });

    test('concurrent calls should share the same rejection', async () => {
        const registryMocked = buildRegistry();
        const error = new Error('registry unreachable');
        registryMocked.getTagsPage = jest.fn().mockImplementation(async () => {
            throw error;
        });
        const settled = await Promise.allSettled([
            registryMocked.getTags(image),
            registryMocked.getTags(image),
        ]);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(1);
        expect(settled[0].status).toEqual('rejected');
        expect(settled[0].reason).toBe(error);
        expect(settled[1].status).toEqual('rejected');
        expect(settled[1].reason).toBe(error);
    });

    test('a call after a rejection should re-fetch', async () => {
        const registryMocked = buildRegistry();
        registryMocked.getTagsPage = jest
            .fn()
            .mockRejectedValueOnce(new Error('registry unreachable'))
            .mockImplementation(async () => tagsPage());
        await expect(registryMocked.getTags(image)).rejects.toThrow(
            'registry unreachable',
        );
        await expect(registryMocked.getTags(image)).resolves.toStrictEqual([
            'v3',
            'v2',
            'v1',
        ]);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(2);
    });

    test('sequential calls should crawl again on a base registry', async () => {
        const registryMocked = buildRegistry();
        registryMocked.getTagsPage = jest
            .fn()
            .mockImplementation(async () => tagsPage());
        await registryMocked.getTags(image);
        await registryMocked.getTags(image);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(2);
    });

    test('supportsIncrementalTagListing should be false when not overridden', () => {
        expect(new Registry().supportsIncrementalTagListing()).toBe(false);
    });

    test('deregisterComponent should clear in-flight requests', async () => {
        const registryMocked = buildRegistry();
        const resolvers = [];
        registryMocked.getTagsPage = jest
            .fn()
            .mockImplementation(
                () => new Promise((resolve) => resolvers.push(resolve)),
            );
        const first = registryMocked.getTags(image);
        await registryMocked.deregisterComponent();
        const second = registryMocked.getTags(image);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(2);
        resolvers.forEach((resolve) => resolve(tagsPage()));
        await Promise.all([first, second]);
    });

    test('a settling stale request should not clear a newer in-flight entry', async () => {
        const registryMocked = buildRegistry();
        const resolvers = [];
        registryMocked.getTagsPage = jest
            .fn()
            .mockImplementation(
                () => new Promise((resolve) => resolvers.push(resolve)),
            );

        const first = registryMocked.getTags(image);
        await registryMocked.deregisterComponent();
        const second = registryMocked.getTags(image);

        resolvers[0](tagsPage());
        await first;

        const third = registryMocked.getTags(image);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(2);

        resolvers[1](tagsPage());
        await Promise.all([second, third]);
    });

    test('deregisterComponent should clear in-flight requests but keep the cached tag list', async () => {
        const registryMocked = new IncrementalRegistry();
        registryMocked.log = log;
        registryMocked.getTagsPage = jest.fn().mockImplementation(async () => ({
            headers: {},
            data: { tags: ['v1', 'v2', 'v3', 'v4'] },
        }));
        await registryMocked.getTags(image);
        await registryMocked.deregisterComponent();
        registryMocked.getTagsPage.mockClear();
        registryMocked.getTagsPage.mockImplementation(async () => ({
            headers: {},
            data: { tags: ['v3', 'v4'] },
        }));

        await expect(registryMocked.getTags(image)).resolves.toStrictEqual([
            'v4',
            'v3',
            'v2',
            'v1',
        ]);
        expect(registryMocked.getTagsPage).toHaveBeenCalledTimes(1);
        expect(registryMocked.getTagsPage.mock.calls[0][1]).toEqual('v2');
    });

    test('a restarted registry should resume from the persisted tag list', async () => {
        const tmp = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), 'wud-registry-'),
        );
        try {
            await tagcache.init({ enabled: true, path: tmp });
            const first = new IncrementalRegistry();
            await first.register('registry', 'ghcr', 'test', {});
            first.getTagsPage = jest.fn().mockImplementation(async () => ({
                headers: {},
                data: { tags: ['v1', 'v2', 'v3', 'v4'] },
            }));
            await first.getTags(image);

            await tagcache.init({ enabled: true, path: tmp });

            const second = new IncrementalRegistry();
            await second.register('registry', 'ghcr', 'test', {});
            second.getTagsPage = jest.fn().mockImplementation(async () => ({
                headers: {},
                data: { tags: ['v3', 'v4', 'v5'] },
            }));
            await expect(second.getTags(image)).resolves.toStrictEqual([
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(second.getTagsPage).toHaveBeenCalledTimes(1);
            expect(second.getTagsPage.mock.calls[0][1]).toEqual('v2');
        } finally {
            await fs.promises.rm(tmp, { recursive: true, force: true });
        }
    });

    test('two registry instances should not share a cached tag list', async () => {
        const first = new IncrementalRegistry();
        await first.register('registry', 'ghcr', 'one', {});
        first.getTagsPage = jest.fn().mockImplementation(async () => ({
            headers: {},
            data: { tags: ['v1', 'v2', 'v3', 'v4'] },
        }));
        await first.getTags(image);

        const second = new IncrementalRegistry();
        await second.register('registry', 'ghcr', 'two', {});
        second.getTagsPage = jest.fn().mockImplementation(async () => ({
            headers: {},
            data: { tags: ['v1', 'v2', 'v3', 'v4'] },
        }));
        await second.getTags(image);

        expect(second.getTagsPage).toHaveBeenCalledTimes(1);
        expect(second.getTagsPage.mock.calls[0][1]).toBeUndefined();
    });
});

test('getImageManifestDigest should return digest for application/vnd.docker.distribution.manifest.list.v2+json then application/vnd.docker.distribution.manifest.v2+json', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    registryMocked.callRegistry = (options) => {
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
        ) {
            return {
                schemaVersion: 2,
                mediaType:
                    'application/vnd.docker.distribution.manifest.list.v2+json',
                manifests: [
                    {
                        platform: {
                            architecture: 'amd64',
                            os: 'linux',
                        },
                        digest: 'digest_x',
                        mediaType:
                            'application/vnd.docker.distribution.manifest.v2+json',
                    },
                    {
                        platform: {
                            architecture: 'armv7',
                            os: 'linux',
                        },
                        digest: 'digest_y',
                        mediaType: 'fail',
                    },
                ],
            };
        }
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.v2+json'
        ) {
            return {
                headers: {
                    'docker-content-digest': '123456789',
                },
            };
        }
        throw new Error('Boom!');
    };
    expect(
        registryMocked.getImageManifestDigest({
            name: 'image',
            architecture: 'amd64',
            os: 'linux',
            tag: {
                value: 'tag',
            },
            registry: {
                url: 'url',
            },
        }),
    ).resolves.toStrictEqual({
        version: 2,
        digest: '123456789',
    });
});

test('getImageManifestDigest should return digest for application/vnd.docker.distribution.manifest.list.v2+json then application/vnd.docker.container.image.v1+json', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    registryMocked.callRegistry = (options) => {
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
        ) {
            return {
                schemaVersion: 2,
                mediaType:
                    'application/vnd.docker.distribution.manifest.list.v2+json',
                manifests: [
                    {
                        platform: {
                            architecture: 'amd64',
                            os: 'linux',
                        },
                        digest: 'digest_x',
                        mediaType:
                            'application/vnd.docker.container.image.v1+json',
                    },
                    {
                        platform: {
                            architecture: 'armv7',
                            os: 'linux',
                        },
                        digest: 'digest_y',
                        mediaType: 'fail',
                    },
                ],
            };
        }
        throw new Error('Boom!');
    };
    expect(
        registryMocked.getImageManifestDigest({
            name: 'image',
            architecture: 'amd64',
            os: 'linux',
            tag: {
                value: 'tag',
            },
            registry: {
                url: 'url',
            },
        }),
    ).resolves.toStrictEqual({
        version: 1,
        digest: 'digest_x',
    });
});

test('getImageManifestDigest should return the manifest digest (not the config digest) for a single-platform application/vnd.docker.distribution.manifest.v2+json response', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    const urlsCalled: string[] = [];
    registryMocked.callRegistry = (options) => {
        urlsCalled.push(options.url);
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
        ) {
            // Realistic single-platform manifest: config.mediaType is a *config*
            // media type, never the manifest's own media type.
            return {
                schemaVersion: 2,
                mediaType:
                    'application/vnd.docker.distribution.manifest.v2+json',
                config: {
                    digest: 'config_digest',
                    mediaType: 'application/vnd.docker.container.image.v1+json',
                },
            };
        }
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.v2+json'
        ) {
            return {
                headers: {
                    'docker-content-digest': 'manifest_digest',
                },
            };
        }
        throw new Error('Boom!');
    };
    await expect(
        registryMocked.getImageManifestDigest({
            name: 'image',
            architecture: 'amd64',
            os: 'linux',
            tag: {
                value: 'tag',
            },
            registry: {
                url: 'url',
            },
        }),
    ).resolves.toStrictEqual({
        version: 2,
        digest: 'manifest_digest',
    });
    // The confirmation request must be made against the reference we already
    // fetched the manifest by (the tag here), never against the config digest.
    expect(urlsCalled).toStrictEqual([
        'url/image/manifests/tag',
        'url/image/manifests/tag',
    ]);
});

test('getImageManifestDigest should resolve a manifest fetched directly by its own digest to that same digest', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    const urlsCalled: string[] = [];
    registryMocked.callRegistry = (options) => {
        urlsCalled.push(options.url);
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
        ) {
            return {
                schemaVersion: 2,
                mediaType: 'application/vnd.oci.image.manifest.v1+json',
                config: {
                    digest: 'config_digest',
                    mediaType: 'application/vnd.oci.image.config.v1+json',
                },
            };
        }
        if (
            options.headers.Accept ===
            'application/vnd.oci.image.manifest.v1+json'
        ) {
            return {
                headers: {
                    'docker-content-digest': 'sha256:platformManifestDigest',
                },
            };
        }
        throw new Error('Boom!');
    };
    // This mirrors what Docker.ts does when re-resolving the container's local
    // RepoDigest: it's already a leaf manifest digest, not a manifest-list digest.
    await expect(
        registryMocked.getImageManifestDigest(
            {
                name: 'image',
                architecture: 'arm64',
                os: 'linux',
                tag: { value: 'latest' },
                registry: { url: 'url' },
            },
            'sha256:platformManifestDigest',
        ),
    ).resolves.toStrictEqual({
        version: 2,
        digest: 'sha256:platformManifestDigest',
    });
    expect(urlsCalled).toStrictEqual([
        'url/image/manifests/sha256:platformManifestDigest',
        'url/image/manifests/sha256:platformManifestDigest',
    ]);
});

test('getImageManifestDigest should return digest for application/vnd.docker.container.image.v1+json', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    registryMocked.callRegistry = (options) => {
        if (
            options.headers.Accept ===
            'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json'
        ) {
            return {
                schemaVersion: 1,
                history: [
                    {
                        v1Compatibility: JSON.stringify({
                            config: {
                                Image: 'xxxxxxxxxx',
                            },
                        }),
                    },
                ],
            };
        }
        throw new Error('Boom!');
    };
    expect(
        registryMocked.getImageManifestDigest({
            name: 'image',
            architecture: 'amd64',
            os: 'linux',
            tag: {
                value: 'tag',
            },
            registry: {
                url: 'url',
            },
        }),
    ).resolves.toStrictEqual({
        version: 1,
        digest: 'xxxxxxxxxx',
        created: undefined,
    });
});

test('getImageManifestDigest should throw when no digest found', async () => {
    const registryMocked = new Registry();
    registryMocked.log = log;
    registryMocked.callRegistry = () => ({});
    expect(
        registryMocked.getImageManifestDigest({
            name: 'image',
            architecture: 'amd64',
            os: 'linux',
            tag: {
                value: 'tag',
            },
            registry: {
                url: 'url',
            },
        }),
    ).rejects.toEqual(new Error('Unexpected error; no manifest found'));
});

test('callRegistry should call authenticate', async () => {
    const { default: axios } = await import('axios');
    axios.mockResolvedValue({ data: {} });
    const registryMocked = new Registry();
    registryMocked.log = log;
    const spyAuthenticate = jest.spyOn(registryMocked, 'authenticate');
    await registryMocked.callRegistry({
        image: {},
        url: 'url',
        method: 'get',
    });
    expect(spyAuthenticate).toHaveBeenCalledTimes(1);
});

describe('shouldWatchDigest', () => {
    test('should return true when label is true', () => {
        const result = registry.shouldWatchDigest('true', 'image/name');
        expect(result).toBe(true);
    });

    test('should return true when label is TRUE (case insensitive)', () => {
        const result = registry.shouldWatchDigest('TRUE', 'image/name');
        expect(result).toBe(true);
    });

    test('should return true without label', () => {
        const result = registry.shouldWatchDigest(undefined, 'image/name');
        expect(result).toBe(true);
    });

    test('should return true with empty label', () => {
        const result = registry.shouldWatchDigest('', 'image/name');
        expect(result).toBe(true);
    });
});
