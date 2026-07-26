// @ts-nocheck
import * as utils from './utils';
import * as registry from '../../../registry';
import Registry from '../../../registries/Registry';
import * as tag from '../../../tag';
import log from '../../../log';
import * as containerModel from '../../../model/container';

// Mock dependencies
jest.mock('../../../registry');
jest.mock('../../../tag');
jest.mock('../../../log', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn().mockReturnThis(),
    registerAxiosErrorLogging: jest.fn(),
}));
jest.mock('../../../model/container');

describe('Docker Watcher Utils', () => {
    let mockLogContainer;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLogContainer = {
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn(),
        };
        containerModel.validate.mockImplementation((c) => c);
        containerModel.fullName.mockImplementation((c) => c.name);
    });

    describe('Registry Utils', () => {
        test('getRegistries should return registries from state', () => {
            const mockRegistries = { docker: {} };
            registry.getState.mockReturnValue({ registry: mockRegistries });
            expect(utils.getRegistries()).toEqual(mockRegistries);
        });

        test('getRegistry should return specific registry', () => {
            const mockProvider = { getId: () => 'docker' };
            registry.getState.mockReturnValue({
                registry: { docker: mockProvider },
            });
            expect(utils.getRegistry('docker')).toEqual(mockProvider);
        });

        test('getRegistry should throw on unsupported registry', () => {
            registry.getState.mockReturnValue({ registry: {} });
            expect(() => utils.getRegistry('unknown')).toThrow(
                'Unsupported Registry unknown',
            );
        });
    });

    describe('getTagCandidates', () => {
        const mockContainer = {
            image: {
                tag: {
                    value: '1.0.0',
                    semver: true,
                },
            },
            transformTags: undefined,
        };

        beforeEach(() => {
            tag.parse.mockImplementation((t) => t); // simplistic mock
            tag.isGreater.mockImplementation((t1, t2) => t1 > t2);
            tag.transform.mockImplementation((x, t) => t);
        });

        test('should filter by includeTags regex', () => {
            const container = { ...mockContainer, includeTags: '^1\\.' };
            const tags = ['1.0.0', '1.1.0', '2.0.0'];
            const result = utils.getTagCandidates(
                container,
                tags,
                mockLogContainer,
            );
            expect(result).toEqual(['1.1.0']);
        });

        test('should filter out sha tags when no includeTags', () => {
            const container = { ...mockContainer, includeTags: undefined };
            const tags = ['1.1.0', 'sha256:abc'];
            const result = utils.getTagCandidates(
                container,
                tags,
                mockLogContainer,
            );
            expect(result).toEqual(['1.1.0']);
        });

        test('should filter out .sig tags', () => {
            const container = { ...mockContainer };
            const tags = ['1.1.0', '1.1.0.sig'];
            const result = utils.getTagCandidates(
                container,
                tags,
                mockLogContainer,
            );
            expect(result).toEqual(['1.1.0']);
        });

        test('should filter by excludeTags regex', () => {
            const container = { ...mockContainer, excludeTags: 'beta' };
            const tags = ['1.1.0', '1.1.0-beta'];
            const result = utils.getTagCandidates(
                container,
                tags,
                mockLogContainer,
            );
            expect(result).toEqual(['1.1.0']);
        });

        test('should return empty if not semver', () => {
            const container = {
                ...mockContainer,
                image: { tag: { semver: false } },
            };
            const tags = ['latest', 'stable'];
            const result = utils.getTagCandidates(
                container,
                tags,
                mockLogContainer,
            );
            expect(result).toEqual([]);
        });

        test('should filter semver tags correctly with prefix', () => {
            // Setup strict semver mocking for this test
            tag.parse.mockImplementation((t) => {
                if (t === 'v1.0.0') return { major: 1, minor: 0, patch: 0 };
                if (t === 'v1.0.1') return { major: 1, minor: 0, patch: 1 };
                if (t === 'v2.0.0') return { major: 2, minor: 0, patch: 0 };
                return null;
            });
            tag.isGreater.mockImplementation((t1, t2) => {
                return t1 > t2;
            });

            // Ah, I want to test that a DIFFERENT prefix is filtered out.
            // e.g. 'root-1.0.0' vs 'user-1.0.0'.
            const container2 = {
                ...mockContainer,
                image: { tag: { value: 'app-1.0.0', semver: true } },
            };

            tag.parse.mockImplementation(() => ({}));

            const tags = ['app-1.1.0', 'other-1.1.0'];
            const result = utils.getTagCandidates(
                container2,
                tags,
                mockLogContainer,
            );

            expect(result).toContain('app-1.1.0');
            expect(result).not.toContain('other-1.1.0');
        });
    });

    describe('normalizeContainer', () => {
        test('should warn if no registry provider found', () => {
            registry.getState.mockReturnValue({ registry: {} });
            const container = {
                id: '123',
                name: 'test',
                image: { registry: { name: 'foo', url: 'bar' } },
            };
            const result = utils.normalizeContainer(container);
            expect(log.warn).toHaveBeenCalled();
            expect(result.image.registry.name).toBe('unknown');
        });

        test('should normalize image using provider', () => {
            const mockProvider = {
                match: jest.fn().mockReturnValue(true),
                normalizeImage: jest
                    .fn()
                    .mockReturnValue({ registry: { name: 'mock' } }),
                getId: jest.fn().mockReturnValue('mock-provider'),
            };
            registry.getState.mockReturnValue({
                registry: { mock: mockProvider },
            });

            const container = {
                id: '123',
                name: 'test',
                image: { registry: { name: 'foo' } },
            };
            const result = utils.normalizeContainer(container);

            expect(mockProvider.normalizeImage).toHaveBeenCalled();
            expect(result.image.registry.name).toBe('mock-provider');
        });
    });

    describe('getContainerName', () => {
        test('should extract name and remove slash', () => {
            const container = { Names: ['/my-container'] };
            expect(utils.getContainerName(container)).toBe('my-container');
        });
    });

    describe('getRepoDigest', () => {
        test('should return digest from RepoDigests', () => {
            const containerImage = { RepoDigests: ['image@sha256:12345'] };
            expect(utils.getRepoDigest(containerImage)).toBe('sha256:12345');
        });

        test('should return undefined if no RepoDigests', () => {
            expect(utils.getRepoDigest({})).toBeUndefined();
        });
    });

    describe('isContainerToWatch', () => {
        test('should return true if label is true', () => {
            expect(utils.isContainerToWatch('true', false)).toBe(true);
        });

        test('should return false if label is false', () => {
            expect(utils.isContainerToWatch('false', true)).toBe(false);
        });

        test('should return default if label undefined', () => {
            expect(utils.isContainerToWatch(undefined, true)).toBe(true);
            expect(utils.isContainerToWatch('', false)).toBe(false);
        });
    });

    describe('findNewVersion', () => {
        test('should throw error if no registry', async () => {
            registry.getState.mockReturnValue({ registry: {} });
            const container = {
                image: {
                    registry: { name: 'unknown' },
                    tag: { value: '1.0.0' },
                },
            };
            // getRegistry throws Error
            await expect(
                utils.findNewVersion(container, null, mockLogContainer),
            ).rejects.toThrow('Unsupported Registry unknown');
        });

        test('should find new version tags', async () => {
            const mockProvider = {
                getTags: jest.fn().mockResolvedValue(['1.0.0', '1.0.1']),
            };
            registry.getState.mockReturnValue({
                registry: { docker: mockProvider },
            });

            // Mock tag module for this test
            tag.parse.mockReturnValue({ major: 1, minor: 0, patch: 1 });
            tag.transform.mockImplementation((x, t) => t);
            tag.isGreater.mockImplementation((t1, t2) => t1 > t2);

            const container = {
                image: {
                    registry: { name: 'docker' },
                    tag: { value: '1.0.0', semver: true },
                    digest: { watch: false },
                },
                transformTags: undefined,
            };

            const result = await utils.findNewVersion(
                container,
                null,
                mockLogContainer,
            );
            expect(result.tag).toBe('1.0.1');
        });

        test('should handle digest watching with v2 manifest when registry allows digest watching', async () => {
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    name: 'library/nginx',
                    tag: { value: 'latest' },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue([]),
                shouldWatchDigest: jest.fn().mockReturnValue(true),
                getImageManifestDigest: jest
                    .fn()
                    .mockResolvedValueOnce({
                        digest: 'sha256:def456',
                        created: '2023-01-01',
                        version: 2,
                    })
                    .mockResolvedValueOnce({
                        digest: 'sha256:manifest123',
                    }),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            const result = await utils.findNewVersion(
                container,
                null,
                mockLogContainer,
            );

            expect(mockRegistry.shouldWatchDigest).toHaveBeenCalled();
            expect(mockRegistry.getImageManifestDigest).toHaveBeenCalledTimes(
                2,
            );
            expect(result.digest).toBe('sha256:def456');
            expect(container.image.digest.value).toBe('sha256:manifest123');
        });

        test('should warn and skip digest check for non-semver image when registry disables digest watching', async () => {
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    name: 'library/nginx',
                    tag: { value: 'latest' },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue([]),
                shouldWatchDigest: jest.fn().mockReturnValue(false),
                getImageManifestDigest: jest.fn(),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });

            await utils.findNewVersion(container, null, mockLogContainer);

            expect(mockLogContainer.warn).toHaveBeenCalledWith(
                expect.stringContaining('digest watching is disabled'),
            );
            expect(mockRegistry.getImageManifestDigest).not.toHaveBeenCalled();
        });

        test('should fall back to the image Id when Config.Image is empty for a legacy v1 manifest', async () => {
            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'hub' },
                    tag: { value: '1.0.0' },
                    digest: { watch: true, repo: 'sha256:abc123' },
                },
            };
            const mockRegistry = {
                getTags: jest.fn().mockResolvedValue(['1.0.0']),
                shouldWatchDigest: jest.fn().mockReturnValue(true),
                getImageManifestDigest: jest.fn().mockResolvedValue({
                    digest: 'sha256:def456',
                    created: '2023-01-01',
                    version: 1,
                }),
            };
            registry.getState.mockReturnValue({
                registry: { hub: mockRegistry },
            });
            const mockDockerApi = {
                getImage: jest.fn().mockReturnValue({
                    inspect: jest.fn().mockResolvedValue({
                        Config: { Image: '' },
                        Id: 'sha256:local123',
                    }),
                }),
            };

            await utils.findNewVersion(
                container,
                mockDockerApi,
                mockLogContainer,
            );

            expect(container.image.digest.value).toBe('sha256:local123');
        });

        test('should not flag a false digest update for a multi-arch image whose local RepoDigest is a leaf manifest digest (regression for ghcr.io/tricked-dev/kanidm-oauth2-manager)', async () => {
            // Reproduces the real-world bug: an OCI index with amd64/arm64 entries,
            // where Docker recorded the arm64 *manifest* digest (not the index
            // digest) as the container's RepoDigest. Both the "remote" lookup (by
            // tag) and the "local" lookup (by RepoDigest) must resolve to the same
            // manifest digest when nothing changed.
            const arm64ManifestDigest =
                'sha256:8f52be5801e341d97f65e9d046d24e37ee980558806127f7c2b2f917670b5332';
            const configDigest =
                'sha256:c611bc3dc9d42510c69180b6328ebcb3a93cd9c739f79cc2b8ce17322a8baed5';

            const ghcrRegistry = new Registry();
            ghcrRegistry.getTags = jest.fn().mockResolvedValue(['latest']);
            ghcrRegistry.callRegistry = jest.fn((options) => {
                if (options.method === 'head') {
                    return Promise.resolve({
                        headers: {
                            'docker-content-digest': arm64ManifestDigest,
                        },
                    });
                }
                if (options.url.endsWith('/manifests/latest')) {
                    return Promise.resolve({
                        schemaVersion: 2,
                        mediaType: 'application/vnd.oci.image.index.v1+json',
                        manifests: [
                            {
                                digest: 'sha256:amd64ManifestDigest',
                                mediaType:
                                    'application/vnd.oci.image.manifest.v1+json',
                                platform: {
                                    architecture: 'amd64',
                                    os: 'linux',
                                },
                            },
                            {
                                digest: arm64ManifestDigest,
                                mediaType:
                                    'application/vnd.oci.image.manifest.v1+json',
                                platform: {
                                    architecture: 'arm64',
                                    os: 'linux',
                                },
                            },
                        ],
                    });
                }
                if (options.url.endsWith(`/manifests/${arm64ManifestDigest}`)) {
                    return Promise.resolve({
                        schemaVersion: 2,
                        mediaType: 'application/vnd.oci.image.manifest.v1+json',
                        config: {
                            digest: configDigest,
                            mediaType:
                                'application/vnd.oci.image.config.v1+json',
                        },
                    });
                }
                throw new Error(`Unexpected request to ${options.url}`);
            });

            const container = {
                image: {
                    id: 'image123',
                    registry: { name: 'ghcr' },
                    name: 'tricked-dev/kanidm-oauth2-manager',
                    tag: { value: 'latest' },
                    architecture: 'arm64',
                    os: 'linux',
                    digest: { watch: true, repo: arm64ManifestDigest },
                },
            };
            registry.getState.mockReturnValue({
                registry: { ghcr: ghcrRegistry },
            });

            const result = await utils.findNewVersion(
                container,
                null,
                mockLogContainer,
            );

            expect(result.digest).toBe(arm64ManifestDigest);
            expect(container.image.digest.value).toBe(arm64ManifestDigest);
            expect(container.image.digest.value).toBe(result.digest);
        });
    });
});
