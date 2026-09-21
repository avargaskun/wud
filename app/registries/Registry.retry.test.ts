import { AxiosInstance, AxiosRequestConfig } from 'axios';
import { ContainerImage } from '../model/container';
import * as tagcache from '../tagcache';
import { getRetryCount } from './retryStats';

const mockObserve = jest.fn();
const mockInc = jest.fn();

jest.mock('../prometheus/registry', () => ({
    getSummaryTags: () => ({ observe: mockObserve }),
    getRetryCounter: () => ({ inc: mockInc }),
}));

import Registry from './Registry';

class TestRegistry extends Registry {
    readonly http = jest.fn();

    readonly sleeps: number[] = [];

    constructor() {
        super();
        this.axiosInstance = this.http as unknown as AxiosInstance;
    }

    protected async sleep(ms: number): Promise<void> {
        this.sleeps.push(ms);
    }

    supportsIncrementalTagListing(): boolean {
        return true;
    }
}

class RealSleepRegistry extends Registry {
    wait(ms: number): Promise<void> {
        return this.sleep(ms);
    }
}

const httpError = (
    status: number,
    options: { headers?: Record<string, string>; data?: unknown } = {},
) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
        config: {
            method: 'get',
            url: 'https://ghcr.io/v2/user/repo/tags/list?n=1000',
            headers: { Accept: 'application/json' },
        },
        response: {
            status,
            headers: options.headers ?? {},
            data: options.data,
        },
    });

const ghcrThrottled = () =>
    httpError(429, {
        data: {
            errors: [
                {
                    code: 'TOOMANYREQUESTS',
                    message: 'retry-after: 982.701µs, allowed: 44000/minute',
                },
            ],
        },
    });

const page = (tags: string[]) => ({ data: { tags }, headers: {} });

const image = {
    name: 'user/repo',
    registry: { url: 'https://ghcr.io/v2' },
} as ContainerImage;

const requestedUrls = (registry: TestRegistry): (string | undefined)[] =>
    registry.http.mock.calls.map(
        ([options]: [AxiosRequestConfig]) => options.url,
    );

describe('callRegistry retries', () => {
    let registry: TestRegistry;
    let mockLog: { debug: jest.Mock; info: jest.Mock; warn: jest.Mock };

    beforeEach(async () => {
        jest.clearAllMocks();
        await tagcache.init({ enabled: false });
        registry = new TestRegistry();
        await registry.register('registry', 'test', 'retry', {});
        mockLog = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
        registry.log = mockLog as unknown as typeof registry.log;
    });

    const call = () =>
        registry.callRegistry<{ tags: string[] }>({
            image,
            url: 'https://ghcr.io/v2/user/repo/tags/list?n=1000',
        });

    test('should recover from a 429 followed by a 200 without warning', async () => {
        const spyAuthenticate = jest.spyOn(registry, 'authenticate');
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockResolvedValueOnce(page(['v1']));

        await expect(call()).resolves.toEqual({ tags: ['v1'] });

        expect(registry.http).toHaveBeenCalledTimes(2);
        expect(registry.http.mock.calls[1][0]).toEqual(
            registry.http.mock.calls[0][0],
        );
        expect(registry.sleeps).toHaveLength(1);
        expect(registry.sleeps[0]).toBeGreaterThanOrEqual(250);
        expect(registry.sleeps[0]).toBeLessThan(500);
        expect(mockLog.warn).not.toHaveBeenCalled();
        expect(spyAuthenticate).toHaveBeenCalledTimes(1);
    });

    test('should return the full response when asked to', async () => {
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockResolvedValueOnce(page(['v1']));

        await expect(
            registry.callRegistry({
                image,
                url: 'https://ghcr.io/v2/user/repo/tags/list?n=1000',
                resolveWithFullResponse: true,
            }),
        ).resolves.toEqual(page(['v1']));
    });

    test('should back off further on a second 429', async () => {
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockRejectedValueOnce(ghcrThrottled())
            .mockResolvedValueOnce(page(['v1']));

        await expect(call()).resolves.toEqual({ tags: ['v1'] });

        expect(registry.sleeps).toHaveLength(2);
        expect(registry.sleeps[0]).toBeGreaterThanOrEqual(250);
        expect(registry.sleeps[0]).toBeLessThan(500);
        expect(registry.sleeps[1]).toBeGreaterThanOrEqual(500);
        expect(registry.sleeps[1]).toBeLessThan(1000);
    });

    test.each([502, 503, 504])(
        'should recover from a %i and count it by status',
        async (status) => {
            registry.http
                .mockRejectedValueOnce(httpError(status))
                .mockResolvedValueOnce(page(['v1']));

            await expect(call()).resolves.toEqual({ tags: ['v1'] });

            expect(mockInc).toHaveBeenCalledTimes(1);
            expect(mockInc).toHaveBeenCalledWith({
                type: 'test',
                name: 'retry',
                status: String(status),
            });
        },
    );

    test('should give up after four attempts and warn once', async () => {
        const last = ghcrThrottled();
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockRejectedValueOnce(ghcrThrottled())
            .mockRejectedValueOnce(ghcrThrottled())
            .mockRejectedValueOnce(last);

        await expect(call()).rejects.toBe(last);

        expect(registry.http).toHaveBeenCalledTimes(4);
        expect(registry.sleeps).toHaveLength(3);
        expect(mockLog.warn).toHaveBeenCalledTimes(3);
        expect(mockLog.warn.mock.calls[0][0]).toContain(
            'Request failed with status code [429]',
        );
        expect(mockLog.warn.mock.calls[1][0]).toContain('Request headers');
        expect(mockLog.warn.mock.calls[2][0]).toContain('Response body');
    });

    test('should log a retried attempt at debug with the hint source', async () => {
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockResolvedValueOnce(page(['v1']));

        await call();

        const debugLines = mockLog.debug.mock.calls.map(([line]) => line);
        expect(debugLines).toEqual(
            expect.arrayContaining([
                expect.stringContaining(
                    'Request failed with status code [429]',
                ),
                expect.stringMatching(
                    /^Retrying in \d+ ms \(attempt 2\/4, status 429, hint 0\.982701 ms from body\)$/,
                ),
            ]),
        );
    });

    test('should not retry a 404', async () => {
        const error = httpError(404);
        registry.http.mockRejectedValueOnce(error);

        await expect(call()).rejects.toBe(error);

        expect(registry.http).toHaveBeenCalledTimes(1);
        expect(registry.sleeps).toHaveLength(0);
        expect(mockLog.warn).toHaveBeenCalledTimes(3);
        expect(mockInc).not.toHaveBeenCalled();
    });

    test('should not retry a 500', async () => {
        registry.http.mockRejectedValueOnce(httpError(500));

        await expect(call()).rejects.toThrow();

        expect(registry.http).toHaveBeenCalledTimes(1);
        expect(registry.sleeps).toHaveLength(0);
    });

    test('should not retry an error without a response', async () => {
        const error = Object.assign(new Error('socket hang up'), {
            code: 'ECONNRESET',
        });
        registry.http.mockRejectedValueOnce(error);

        await expect(call()).rejects.toBe(error);

        expect(registry.http).toHaveBeenCalledTimes(1);
        expect(registry.sleeps).toHaveLength(0);
        expect(mockLog.warn).not.toHaveBeenCalled();
    });

    test('should not retry when the server asks for more than the cap', async () => {
        const error = httpError(429, { headers: { 'retry-after': '120' } });
        registry.http.mockRejectedValueOnce(error);

        await expect(call()).rejects.toBe(error);

        expect(registry.http).toHaveBeenCalledTimes(1);
        expect(registry.sleeps).toHaveLength(0);
        expect(mockLog.warn).toHaveBeenCalledTimes(3);
    });

    test('should wait at least as long as the Retry-After header', async () => {
        registry.http
            .mockRejectedValueOnce(
                httpError(429, { headers: { 'retry-after': '2' } }),
            )
            .mockResolvedValueOnce(page(['v1']));

        await call();

        expect(registry.sleeps[0]).toBeGreaterThanOrEqual(2000);
        expect(registry.sleeps[0]).toBeLessThan(2250);
    });

    test('should wait at least as long as the in-body hint', async () => {
        registry.http
            .mockRejectedValueOnce(
                httpError(429, { data: 'retry-after: 5s, allowed: 1/minute' }),
            )
            .mockResolvedValueOnce(page(['v1']));

        await call();

        expect(registry.sleeps[0]).toBeGreaterThanOrEqual(5000);
        expect(registry.sleeps[0]).toBeLessThan(5250);
    });

    test('should fall back to backoff when the hint is unparseable', async () => {
        registry.http
            .mockRejectedValueOnce(
                httpError(429, { headers: { 'retry-after': 'soon' } }),
            )
            .mockResolvedValueOnce(page(['v1']));

        await call();

        expect(registry.sleeps[0]).toBeGreaterThanOrEqual(250);
        expect(registry.sleeps[0]).toBeLessThan(500);
    });

    test('should observe every attempt and count every retry', async () => {
        const retriesBefore = getRetryCount();
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockRejectedValueOnce(ghcrThrottled())
            .mockResolvedValueOnce(page(['v1']));

        await call();

        expect(mockObserve).toHaveBeenCalledTimes(3);
        expect(mockInc).toHaveBeenCalledTimes(2);
        expect(getRetryCount() - retriesBefore).toBe(2);
    });

    describe('with incremental tag listing', () => {
        beforeEach(async () => {
            registry.http.mockResolvedValueOnce(
                page(['v1', 'v2', 'v3', 'v4', 'v5']),
            );
            await registry.getTags(image);
            registry.http.mockClear();
            registry.sleeps.length = 0;
        });

        test('should retry the same watermark request instead of crawling', async () => {
            registry.http
                .mockRejectedValueOnce(ghcrThrottled())
                .mockResolvedValueOnce(page(['v4', 'v5', 'v6']));

            await expect(registry.getTags(image)).resolves.toEqual([
                'v6',
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);

            expect(requestedUrls(registry)).toEqual([
                'https://ghcr.io/v2/user/repo/tags/list?n=1000&last=v3',
                'https://ghcr.io/v2/user/repo/tags/list?n=1000&last=v3',
            ]);
        });

        test('should keep the cached list when retries are exhausted', async () => {
            registry.http
                .mockRejectedValueOnce(ghcrThrottled())
                .mockRejectedValueOnce(ghcrThrottled())
                .mockRejectedValueOnce(ghcrThrottled())
                .mockRejectedValueOnce(ghcrThrottled());

            await expect(registry.getTags(image)).rejects.toThrow(
                'Request failed with status code 429',
            );

            registry.http.mockClear();
            registry.http.mockResolvedValueOnce(page(['v4', 'v5']));

            await expect(registry.getTags(image)).resolves.toEqual([
                'v5',
                'v4',
                'v3',
                'v2',
                'v1',
            ]);
            expect(requestedUrls(registry)).toEqual([
                'https://ghcr.io/v2/user/repo/tags/list?n=1000&last=v3',
            ]);
        });
    });

    test('should share one retried request between concurrent getTags callers', async () => {
        registry.http
            .mockRejectedValueOnce(ghcrThrottled())
            .mockResolvedValueOnce(page(['a', 'b']));

        const [first, second] = await Promise.all([
            registry.getTags(image),
            registry.getTags(image),
        ]);

        expect(registry.http).toHaveBeenCalledTimes(2);
        expect(first).toEqual(['b', 'a']);
        expect(second).toBe(first);
    });
});

test('sleep should resolve after the delay', async () => {
    const registry = new RealSleepRegistry();
    await expect(registry.wait(1)).resolves.toBeUndefined();
});
