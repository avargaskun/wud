import { AxiosResponse } from 'axios';
import { ContainerImage } from '../../../model/container';
import { ComponentConfiguration } from '../../../registry/Component';
import { RegistryTagsList } from '../../Registry';
import Ghcr from './Ghcr';
import * as tagcache from '../../../tagcache';

describe('GitHub Container Registry', () => {
    let ghcr: Ghcr;

    beforeEach(async () => {
        ghcr = new Ghcr();
        await ghcr.register('registry', 'ghcr', 'test', {
            username: 'testuser',
            token: 'testtoken',
        });
    });

    test('should create instance', async () => {
        expect(ghcr).toBeDefined();
        expect(ghcr).toBeInstanceOf(Ghcr);
    });

    test('should match registry', async () => {
        expect(ghcr.match('ghcr.io')).toBe(true);
        expect(ghcr.match('docker.io')).toBe(false);
    });

    test('should normalize image name', async () => {
        const image = {
            name: 'user/repo',
            registry: { url: 'ghcr.io' },
        } as ContainerImage;
        const normalized = ghcr.normalizeImage(image);
        expect(normalized.name).toBe('user/repo');
        expect(normalized.registry.url).toBe('https://ghcr.io/v2');
    });

    test('should not modify URL if already starts with https', async () => {
        const image = {
            name: 'user/repo',
            registry: { url: 'https://ghcr.io/v2' },
        } as ContainerImage;
        const normalized = ghcr.normalizeImage(image);
        expect(normalized.registry.url).toBe('https://ghcr.io/v2');
    });

    test('should mask configuration token', async () => {
        ghcr.configuration = { username: 'testuser', token: 'secret_token' };
        const masked = ghcr.maskConfiguration();
        expect(masked.username).toBe('testuser');
        expect(masked.token).toBe('s**********n');
    });

    test('should return auth pull credentials', async () => {
        ghcr.configuration = { username: 'testuser', token: 'testtoken' };
        const auth = await ghcr.getAuthPull();
        expect(auth).toEqual({
            username: 'testuser',
            password: 'testtoken',
        });
    });

    test('should return undefined auth pull when no credentials', async () => {
        ghcr.configuration = {};
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });

    test('should authenticate with token', async () => {
        ghcr.configuration = { token: 'test-token' };
        const image = { name: 'user/repo' } as ContainerImage;
        const requestOptions = { headers: {} };

        const result = await ghcr.authenticate(image, requestOptions);

        const expectedBearer = Buffer.from('test-token', 'utf-8').toString(
            'base64',
        );
        expect(result.headers.Authorization).toBe(`Bearer ${expectedBearer}`);
    });

    test('should authenticate without token', async () => {
        ghcr.configuration = {};
        const image = { name: 'user/repo' } as ContainerImage;
        const requestOptions = { headers: {} };

        const result = await ghcr.authenticate(image, requestOptions);

        const expectedBearer = Buffer.from(':', 'utf-8').toString('base64');
        expect(result.headers.Authorization).toBe(`Bearer ${expectedBearer}`);
    });

    test('should validate string configuration', async () => {
        expect(() =>
            ghcr.validateConfiguration('' as unknown as ComponentConfiguration),
        ).not.toThrow();
        expect(() =>
            ghcr.validateConfiguration(
                'some-string' as unknown as ComponentConfiguration,
            ),
        ).not.toThrow();
    });

    test('should validate configuration with only incrementaltags', async () => {
        expect(() =>
            ghcr.validateConfiguration({ incrementaltags: false }),
        ).not.toThrow();
    });

    test('should throw when username is provided without token', async () => {
        expect(() => ghcr.validateConfiguration({ username: 'x' })).toThrow();
    });

    test('should return undefined auth pull when missing username', async () => {
        ghcr.configuration = { token: 'test-token' };
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });

    test('should return undefined auth pull when missing token', async () => {
        ghcr.configuration = { username: 'testuser' };
        const auth = await ghcr.getAuthPull();
        expect(auth).toBeUndefined();
    });

    describe('incremental tag listing', () => {
        beforeEach(async () => {
            await tagcache.init({ enabled: false });
        });

        const image = {
            name: 'user/repo',
            registry: { url: 'https://ghcr.io/v2' },
        } as ContainerImage;

        const page = (tags: string[] | null, link?: string) =>
            ({
                data: { tags },
                headers: link ? { link } : {},
            }) as AxiosResponse<RegistryTagsList>;

        const nextLink =
            '<https://ghcr.io/v2/user/repo/tags/list?n=1000&last=v6>; rel="next"';

        const stubPages = (
            ...pages: AxiosResponse<RegistryTagsList>[]
        ): jest.Mock => {
            const getTagsPage = jest.fn();
            pages.forEach((p) => getTagsPage.mockResolvedValueOnce(p));
            ghcr.getTagsPage = getTagsPage;
            return getTagsPage;
        };

        test('supportsIncrementalTagListing should be true', async () => {
            expect(ghcr.supportsIncrementalTagListing()).toBe(true);
        });

        test('should resume from the registry-order watermark', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v4', 'v5', 'v6']),
            );

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);

            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(1);
            expect(getTagsPage.mock.calls[0][1]).toEqual('v3');
        });

        test('should watermark on registry order, not sorted order', async () => {
            const getTagsPage = stubPages(
                page(['b', 'a', 'd', 'c', 'e']),
                page(['c', 'e', 'f']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'f',
                'e',
                'd',
                'c',
                'b',
                'a',
            ]);
            expect(getTagsPage.mock.calls[0][1]).toEqual('d');
        });

        test('should return the cached list when the delta is empty', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v4', 'v5']),
            );

            const first = await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual(first);
            expect(getTagsPage).toHaveBeenCalledTimes(1);
        });

        test('should full-crawl when the delta cursor no longer exists', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(null),
                page(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']),
                page(['v5', 'v6']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(2);

            getTagsPage.mockClear();

            await ghcr.getTags(image);
            expect(getTagsPage).toHaveBeenCalledTimes(1);
            expect(getTagsPage.mock.calls[0][1]).toEqual('v4');
        });

        test('should full-crawl when the delta echo does not match', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v9', 'v5', 'v6']),
                page(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(2);
            expect(getTagsPage.mock.calls[1][1]).toBeUndefined();
        });

        test('should full-crawl when the delta is shorter than the echo', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v4']),
                page(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(2);
            expect(getTagsPage.mock.calls[1][1]).toBeUndefined();
        });

        test('should follow every page of a multi-page delta', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v4', 'v5', 'v6'], nextLink),
                page(['v7', 'v8']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v8',
                'v7',
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(2);
            expect(getTagsPage.mock.calls[1][1]).toEqual('v6');
            expect(getTagsPage.mock.calls[1][2]).toEqual(nextLink);
        });

        test('should stop paginating on an empty page carrying a link header', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v4', 'v5', 'v6'], nextLink),
                page([], nextLink),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(2);
        });

        test('should full-crawl a list shorter than the watermark window', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3']),
                page(['v1', 'v2', 'v3']),
            );
            const infoSpy = jest.spyOn(ghcr.log, 'info');

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(1);
            expect(getTagsPage.mock.calls[0][1]).toBeUndefined();
            expect(infoSpy).not.toHaveBeenCalled();
        });

        test('should keep a re-pushed tag once, at its new position', async () => {
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v4', 'v5', 'v2']),
                page(['v5', 'v2']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            const merged = await ghcr.getTags(image);
            expect(merged).toEqual(['v5', 'v4', 'v3', 'v2', 'v1']);
            expect(merged.filter((tag) => tag === 'v2')).toHaveLength(1);

            getTagsPage.mockClear();

            await ghcr.getTags(image);
            expect(getTagsPage).toHaveBeenCalledTimes(1);
            expect(getTagsPage.mock.calls[0][1]).toEqual('v4');
        });

        test('should full-crawl when incremental tag listing is disabled', async () => {
            ghcr.configuration = {
                username: 'testuser',
                token: 'testtoken',
                incrementaltags: false,
            };
            const getTagsPage = stubPages(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
                page(['v1', 'v2', 'v3', 'v4', 'v5', 'v6']),
            );

            await ghcr.getTags(image);
            getTagsPage.mockClear();

            await expect(ghcr.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(getTagsPage).toHaveBeenCalledTimes(1);
            expect(getTagsPage.mock.calls[0][1]).toBeUndefined();
        });

        test('should be enabled on a default registry', async () => {
            const ghcrDefault = new Ghcr();
            await ghcrDefault.register(
                'registry',
                'ghcr',
                'public',
                '' as unknown as ComponentConfiguration,
            );
            expect(ghcrDefault.configuration).toStrictEqual({});
            expect(ghcrDefault.isIncrementalTagListingEnabled()).toBe(true);

            ghcr.configuration = '' as unknown as ComponentConfiguration;
            expect(ghcr.isIncrementalTagListingEnabled()).toBe(true);
        });

        test('should be disabled by an uncoerced string false', async () => {
            ghcr.configuration = {
                incrementaltags: 'false',
            } as unknown as ComponentConfiguration;
            expect(ghcr.isIncrementalTagListingEnabled()).toBe(false);
        });
    });
});
