// @ts-nocheck
import * as utils from './utils';
import * as registry from '../../../registry';
import * as tag from '../../../tag';
import log from '../../../log';
import * as containerModel from '../../../model/container';

// Mock dependencies
jest.mock('../../../registry');
jest.mock('../../../tag');
jest.mock('../../../log', () => ({
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn().mockReturnThis(),
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

    describe('isDigestToWatch', () => {
        const dockerImage = { domain: 'docker.io', path: 'nginx' };

        test('should return true if label is true', () => {
            expect(utils.isDigestToWatch('true', dockerImage, false)).toBe(
                true,
            );
        });

        test('should return false if semver', () => {
            expect(utils.isDigestToWatch(undefined, dockerImage, true)).toBe(
                false,
            );
        });

        test('should return false if docker hub and no label', () => {
            expect(utils.isDigestToWatch(undefined, dockerImage, false)).toBe(
                false,
            );
        });

        test('should return true if non-semver and non-dockerhub', () => {
            const privateImage = { domain: 'private.registry', path: 'image' };
            expect(utils.isDigestToWatch(undefined, privateImage, false)).toBe(
                true,
            );
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
    });
});
