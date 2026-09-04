// @ts-nocheck
import log from '../log';

jest.mock('axios');
jest.mock('../prometheus/registry', () => ({
    getSummaryTags: () => ({
        observe: () => {},
    }),
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

describe('getImageVersionLabel', () => {
    const MANIFEST_ACCEPT_HEADER =
        'application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json';

    const buildImage = (extra = {}) => ({
        name: 'image',
        architecture: 'amd64',
        os: 'linux',
        tag: { value: 'tag' },
        registry: { url: 'url' },
        ...extra,
    });

    const buildRegistry = (callRegistry) => {
        const registryMocked = new Registry();
        registryMocked.log = log;
        registryMocked.callRegistry = jest.fn(callRegistry);
        return registryMocked;
    };

    const urlsOf = (registryMocked) =>
        registryMocked.callRegistry.mock.calls.map(([options]) => options.url);

    test('should follow index -> child manifest -> config blob', async () => {
        const registryMocked = buildRegistry((options) => {
            if (options.url === 'url/image/manifests/stable') {
                expect(options.headers.Accept).toEqual(MANIFEST_ACCEPT_HEADER);
                return {
                    schemaVersion: 2,
                    mediaType: 'application/vnd.oci.image.index.v1+json',
                    manifests: [
                        {
                            platform: { architecture: 'arm64', os: 'linux' },
                            digest: 'digest_arm64',
                            mediaType:
                                'application/vnd.oci.image.manifest.v1+json',
                        },
                        {
                            platform: { architecture: 'amd64', os: 'linux' },
                            digest: 'digest_amd64',
                            mediaType:
                                'application/vnd.oci.image.manifest.v1+json',
                        },
                    ],
                };
            }
            if (options.url === 'url/image/manifests/digest_amd64') {
                return {
                    schemaVersion: 2,
                    mediaType: 'application/vnd.oci.image.manifest.v1+json',
                    config: {
                        digest: 'sha256:config_amd64',
                        mediaType: 'application/vnd.oci.image.config.v1+json',
                    },
                };
            }
            if (options.url === 'url/image/blobs/sha256:config_amd64') {
                return {
                    config: {
                        Labels: {
                            'org.opencontainers.image.version': '2.37.9',
                        },
                    },
                };
            }
            throw new Error('Boom!');
        });
        await expect(
            registryMocked.getImageVersionLabel(buildImage(), 'stable'),
        ).resolves.toEqual('2.37.9');
        expect(registryMocked.callRegistry).toHaveBeenCalledTimes(3);
        expect(urlsOf(registryMocked)[2]).toContain('/blobs/');
    });

    test('should skip the child lookup for a single-platform manifest', async () => {
        const registryMocked = buildRegistry((options) => {
            if (options.url === 'url/image/manifests/stable') {
                return {
                    schemaVersion: 2,
                    mediaType: 'application/vnd.oci.image.manifest.v1+json',
                    config: {
                        digest: 'sha256:config_single',
                        mediaType: 'application/vnd.oci.image.config.v1+json',
                    },
                };
            }
            if (options.url === 'url/image/blobs/sha256:config_single') {
                return {
                    config: {
                        Labels: {
                            'org.opencontainers.image.version': '2.37.9',
                        },
                    },
                };
            }
            throw new Error('Boom!');
        });
        await expect(
            registryMocked.getImageVersionLabel(buildImage(), 'stable'),
        ).resolves.toEqual('2.37.9');
        expect(registryMocked.callRegistry).toHaveBeenCalledTimes(2);
    });

    test('should return undefined when the config blob has no version label', async () => {
        const registryMocked = buildRegistry((options) => {
            if (options.url === 'url/image/manifests/stable') {
                return {
                    schemaVersion: 2,
                    mediaType: 'application/vnd.oci.image.manifest.v1+json',
                    config: {
                        digest: 'sha256:config_single',
                        mediaType: 'application/vnd.oci.image.config.v1+json',
                    },
                };
            }
            if (options.url === 'url/image/blobs/sha256:config_single') {
                return {
                    config: {
                        Labels: {
                            'org.opencontainers.image.title': 'image',
                        },
                    },
                };
            }
            throw new Error('Boom!');
        });
        await expect(
            registryMocked.getImageVersionLabel(buildImage(), 'stable'),
        ).resolves.toBeUndefined();
    });

    test('should return undefined for a schemaVersion 1 manifest without calling the blob', async () => {
        const registryMocked = buildRegistry(() => ({
            schemaVersion: 1,
            history: [{ v1Compatibility: '{}' }],
        }));
        await expect(
            registryMocked.getImageVersionLabel(buildImage(), 'stable'),
        ).resolves.toBeUndefined();
        expect(registryMocked.callRegistry).toHaveBeenCalledTimes(1);
        expect(urlsOf(registryMocked)).not.toContainEqual(
            expect.stringContaining('/blobs/'),
        );
    });

    test('should return undefined when no manifest matches the platform', async () => {
        const registryMocked = buildRegistry(() => ({
            schemaVersion: 2,
            mediaType: 'application/vnd.oci.image.index.v1+json',
            manifests: [
                {
                    platform: { architecture: 'arm64', os: 'linux' },
                    digest: 'digest_arm64',
                    mediaType: 'application/vnd.oci.image.manifest.v1+json',
                },
            ],
        }));
        await expect(
            registryMocked.getImageVersionLabel(buildImage(), 'stable'),
        ).resolves.toBeUndefined();
        expect(registryMocked.callRegistry).toHaveBeenCalledTimes(1);
        expect(urlsOf(registryMocked)).not.toContainEqual(
            expect.stringContaining('/blobs/'),
        );
    });

    test('should propagate a registry error', async () => {
        const registryMocked = buildRegistry(() => {
            throw new Error('Boom!');
        });
        await expect(
            registryMocked.getImageVersionLabel(buildImage(), 'stable'),
        ).rejects.toEqual(new Error('Boom!'));
    });

    test('should refine multiple matching manifests using the image variant', async () => {
        const registryMocked = buildRegistry((options) => {
            if (options.url === 'url/image/manifests/stable') {
                return {
                    schemaVersion: 2,
                    mediaType: 'application/vnd.oci.image.index.v1+json',
                    manifests: [
                        {
                            platform: {
                                architecture: 'amd64',
                                os: 'linux',
                                variant: 'v7',
                            },
                            digest: 'digest_v7',
                            mediaType:
                                'application/vnd.oci.image.manifest.v1+json',
                        },
                        {
                            platform: {
                                architecture: 'amd64',
                                os: 'linux',
                                variant: 'v8',
                            },
                            digest: 'digest_v8',
                            mediaType:
                                'application/vnd.oci.image.manifest.v1+json',
                        },
                    ],
                };
            }
            if (options.url === 'url/image/manifests/digest_v8') {
                return {
                    schemaVersion: 2,
                    mediaType: 'application/vnd.oci.image.manifest.v1+json',
                    config: {
                        digest: 'sha256:config_v8',
                        mediaType: 'application/vnd.oci.image.config.v1+json',
                    },
                };
            }
            if (options.url === 'url/image/blobs/sha256:config_v8') {
                return {
                    config: {
                        Labels: {
                            'org.opencontainers.image.version': '2.37.9',
                        },
                    },
                };
            }
            throw new Error('Boom!');
        });
        await expect(
            registryMocked.getImageVersionLabel(
                buildImage({ variant: 'v8' }),
                'stable',
            ),
        ).resolves.toEqual('2.37.9');
        expect(urlsOf(registryMocked)[1]).toEqual(
            'url/image/manifests/digest_v8',
        );
    });
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
