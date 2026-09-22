import {
    CAP_MS,
    FLOOR_MS,
    MAX_ATTEMPTS,
    computeDelay,
    getErrorResponse,
    isRetryable,
    parseRetryHint,
} from './retry';

const httpError = (
    status: number,
    options: { headers?: Record<string, unknown>; data?: unknown } = {},
) =>
    Object.assign(new Error(`Request failed with status code ${status}`), {
        response: {
            status,
            headers: options.headers ?? {},
            data: options.data,
        },
    });

const ghcrBody = (duration: string) => ({
    errors: [
        {
            code: 'TOOMANYREQUESTS',
            message: `retry-after: ${duration}, allowed: 44000/minute`,
        },
    ],
});

const NOW = Date.parse('2026-09-20T02:00:00Z');

describe('constants', () => {
    test('should match the agreed policy', () => {
        expect(MAX_ATTEMPTS).toBe(4);
        expect(FLOOR_MS).toBe(250);
        expect(CAP_MS).toBe(30000);
    });
});

describe('getErrorResponse', () => {
    test('should return the response of an http error', () => {
        expect(getErrorResponse(httpError(429))?.status).toBe(429);
    });

    test.each([
        ['undefined', undefined],
        ['null', null],
        ['a string', 'boom'],
        ['a plain Error', new Error('boom')],
        [
            'a response without a numeric status',
            { response: { status: '429' } },
        ],
    ])('should return undefined for %s', (_label, error) => {
        expect(getErrorResponse(error)).toBeUndefined();
    });
});

describe('isRetryable', () => {
    test.each([429, 502, 503, 504])('should retry status %i', (status) => {
        expect(isRetryable(httpError(status))).toBe(true);
    });

    test.each([400, 401, 403, 404, 500, 501])(
        'should not retry status %i',
        (status) => {
            expect(isRetryable(httpError(status))).toBe(false);
        },
    );

    test('should not retry an error without a response', () => {
        const error = Object.assign(new Error('socket hang up'), {
            code: 'ECONNRESET',
        });
        expect(isRetryable(error)).toBe(false);
    });

    test('should not retry a plain Error', () => {
        expect(isRetryable(new Error('boom'))).toBe(false);
    });
});

describe('parseRetryHint', () => {
    test('should parse a delta-seconds header', () => {
        const error = httpError(429, { headers: { 'retry-after': '2' } });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 2000,
            source: 'header',
        });
    });

    test('should parse a fractional delta-seconds header', () => {
        const error = httpError(429, { headers: { 'retry-after': '0.5' } });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 500,
            source: 'header',
        });
    });

    test('should find the header whatever its case', () => {
        const error = httpError(429, { headers: { 'Retry-After': '3' } });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 3000,
            source: 'header',
        });
    });

    test('should parse an http date in the future', () => {
        const error = httpError(503, {
            headers: { 'retry-after': 'Sun, 20 Sep 2026 02:00:10 GMT' },
        });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 10000,
            source: 'header',
        });
    });

    test('should clamp an http date in the past to zero', () => {
        const error = httpError(503, {
            headers: { 'retry-after': 'Sun, 20 Sep 2026 01:59:00 GMT' },
        });
        expect(parseRetryHint(error, NOW)).toEqual({ ms: 0, source: 'header' });
    });

    test.each(['soon', '-5', '', '12abc'])(
        'should ignore the unparseable header %p',
        (value) => {
            const error = httpError(429, { headers: { 'retry-after': value } });
            expect(parseRetryHint(error, NOW)).toBeUndefined();
        },
    );

    test('should parse the GHCR in-body hint', () => {
        const error = httpError(429, { data: ghcrBody('982.701µs') });
        const hint = parseRetryHint(error, NOW);
        expect(hint?.source).toBe('body');
        expect(hint?.ms).toBeCloseTo(0.982701, 6);
    });

    test.each([
        ['micro sign U+00B5', '808.179µs', 0.808179],
        ['greek mu U+03BC', '808.179μs', 0.808179],
        ['us', '250us', 0.25],
        ['ns', '1500000ns', 1.5],
        ['ms', '1.5ms', 1.5],
        ['s', '5s', 5000],
        ['m', '2m', 120000],
        ['h', '1h', 3600000],
        ['compound', '1m30s', 90000],
        ['compound with ms', '1s500ms', 1500],
    ])('should parse a %s body duration', (_label, duration, expectedMs) => {
        const error = httpError(429, { data: ghcrBody(duration) });
        expect(parseRetryHint(error, NOW)?.ms).toBeCloseTo(expectedMs, 6);
    });

    test('should parse a body that is a string', () => {
        const error = httpError(429, {
            data: 'TOOMANYREQUESTS retry-after: 2s, allowed: 44000/minute',
        });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 2000,
            source: 'body',
        });
    });

    test('should return undefined when the body carries no hint', () => {
        const error = httpError(429, {
            data: {
                errors: [{ code: 'TOOMANYREQUESTS', message: 'slow down' }],
            },
        });
        expect(parseRetryHint(error, NOW)).toBeUndefined();
    });

    test('should return undefined when there is no body', () => {
        expect(parseRetryHint(httpError(429), NOW)).toBeUndefined();
    });

    test('should prefer the header over the body', () => {
        const error = httpError(429, {
            headers: { 'retry-after': '4' },
            data: ghcrBody('982.701µs'),
        });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 4000,
            source: 'header',
        });
    });

    test('should fall back to the body when the header is unparseable', () => {
        const error = httpError(429, {
            headers: { 'retry-after': 'soon' },
            data: ghcrBody('3s'),
        });
        expect(parseRetryHint(error, NOW)).toEqual({
            ms: 3000,
            source: 'body',
        });
    });

    test('should return undefined for an error without a response', () => {
        expect(parseRetryHint(new Error('boom'), NOW)).toBeUndefined();
    });
});

describe('computeDelay', () => {
    const noJitter = () => 0;
    const maxJitter = () => 0.999;

    test('should back off exponentially from the floor', () => {
        expect(computeDelay(1, undefined, noJitter)).toBe(250);
        expect(computeDelay(2, undefined, noJitter)).toBe(500);
        expect(computeDelay(3, undefined, noJitter)).toBe(1000);
    });

    test('should add up to one backoff of jitter', () => {
        expect(computeDelay(1, undefined, maxJitter)).toBe(499);
        expect(computeDelay(2, undefined, maxJitter)).toBe(999);
        expect(computeDelay(3, undefined, maxJitter)).toBe(1999);
    });

    test('should raise a sub-floor hint to the floor', () => {
        expect(computeDelay(1, 0.982701, noJitter)).toBe(250);
        expect(computeDelay(1, 0, noJitter)).toBe(250);
    });

    test('should treat a hint as a lower bound', () => {
        expect(computeDelay(1, 5000, noJitter)).toBe(5000);
        expect(computeDelay(1, 5000, maxJitter)).toBe(5249);
    });

    test('should keep the backoff when it exceeds the hint', () => {
        expect(computeDelay(3, 400, noJitter)).toBe(1000);
    });

    test('should refuse to retry when the hint exceeds the cap', () => {
        expect(computeDelay(1, CAP_MS + 1, noJitter)).toBeUndefined();
        expect(computeDelay(1, 120000, noJitter)).toBeUndefined();
    });

    test('should never exceed the cap', () => {
        expect(computeDelay(1, CAP_MS, maxJitter)).toBe(CAP_MS);
    });

    test('should default to Math.random', () => {
        const delay = computeDelay(1);
        expect(delay).toBeGreaterThanOrEqual(250);
        expect(delay).toBeLessThan(500);
    });
});
