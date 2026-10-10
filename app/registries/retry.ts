export const MAX_ATTEMPTS = 4;
export const FLOOR_MS = 250;
export const CAP_MS = 30_000;

export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export const DURATION_UNITS_MS: Record<string, number> = {
    ns: 1e-6,
    us: 1e-3,
    µs: 1e-3,
    μs: 1e-3,
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
};

const DURATION_TOKEN = '\\d+(?:\\.\\d+)?(?:ns|us|\\u00b5s|\\u03bcs|ms|s|m|h)';
export const BODY_HINT_PATTERN = new RegExp(
    `[Rr]etry-[Aa]fter:\\s*((?:${DURATION_TOKEN})+)`,
);
export const DURATION_TOKEN_PATTERN = /(\d+(?:\.\d+)?)(ns|us|µs|μs|ms|s|m|h)/g;

export interface HttpErrorResponse {
    status: number;
    headers?: Record<string, unknown>;
    data?: unknown;
}

export interface RetryHint {
    ms: number;
    source: 'header' | 'body' | 'message';
}

export interface RetryDecision {
    status: number;
    hint?: RetryHint;
}

export type RetryClassifier = (error: unknown) => RetryDecision | undefined;

export interface RetryEvent {
    error: unknown;
    attempt: number;
    delay: number;
    decision: RetryDecision;
}

export interface RetryOptions {
    classify: RetryClassifier;
    onRetry: (event: RetryEvent) => void;
    sleep: (ms: number) => Promise<void>;
    random?: () => number;
}

export function getErrorResponse(
    error: unknown,
): HttpErrorResponse | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const { response } = error as { response?: unknown };
    if (typeof response !== 'object' || response === null) {
        return undefined;
    }
    if (typeof (response as { status?: unknown }).status !== 'number') {
        return undefined;
    }
    return response as HttpErrorResponse;
}

export function isRetryableStatus(status: number): boolean {
    return RETRYABLE_STATUSES.has(status);
}

export function isRetryable(error: unknown): boolean {
    const response = getErrorResponse(error);
    return response !== undefined && isRetryableStatus(response.status);
}

function getHeader(
    headers: Record<string, unknown> | undefined,
    name: string,
): string | undefined {
    if (!headers) {
        return undefined;
    }
    const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
    const value = key === undefined ? undefined : headers[key];
    return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined;
}

function parseRetryAfterHeader(value: string, now: number): number | undefined {
    const trimmed = value.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
        return Number(trimmed) * 1000;
    }
    // Date.parse accepts far more than an HTTP-date, which always ends in GMT
    if (!/GMT$/i.test(trimmed)) {
        return undefined;
    }
    const date = Date.parse(trimmed);
    return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export function parseDurationHint(text: string): number | undefined {
    const match = BODY_HINT_PATTERN.exec(text);
    if (!match) {
        return undefined;
    }
    let total = 0;
    for (const [, amount, unit] of match[1].matchAll(DURATION_TOKEN_PATTERN)) {
        total += Number(amount) * DURATION_UNITS_MS[unit];
    }
    return Number.isFinite(total) ? total : undefined;
}

function parseBodyHint(data: unknown): number | undefined {
    if (data === undefined || data === null) {
        return undefined;
    }
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return parseDurationHint(text ?? '');
}

export function parseRetryHint(
    error: unknown,
    now: number = Date.now(),
): RetryHint | undefined {
    const response = getErrorResponse(error);
    if (!response) {
        return undefined;
    }
    const header = getHeader(response.headers, 'retry-after');
    if (header !== undefined) {
        const headerMs = parseRetryAfterHeader(header, now);
        if (headerMs !== undefined) {
            return { ms: headerMs, source: 'header' };
        }
    }
    const bodyMs = parseBodyHint(response.data);
    return bodyMs === undefined ? undefined : { ms: bodyMs, source: 'body' };
}

export function computeDelay(
    retryNumber: number,
    hintMs?: number,
    random: () => number = Math.random,
): number | undefined {
    if (hintMs !== undefined && hintMs > CAP_MS) {
        return undefined;
    }
    const backoff = FLOOR_MS * 2 ** (retryNumber - 1);
    const delay = Math.max(hintMs ?? 0, backoff) + random() * backoff;
    return Math.min(Math.floor(delay), CAP_MS);
}

export function classifyHttpError(error: unknown): RetryDecision | undefined {
    const response = getErrorResponse(error);
    if (!response || !isRetryableStatus(response.status)) {
        return undefined;
    }
    return { status: response.status, hint: parseRetryHint(error) };
}

export function formatRetryMessage({
    attempt,
    delay,
    decision,
}: RetryEvent): string {
    const { status, hint } = decision;
    const hintLabel = hint ? `${hint.ms} ms from ${hint.source}` : 'none';
    return `Retrying in ${delay} ms (attempt ${attempt}/${MAX_ATTEMPTS}, status ${status}, hint ${hintLabel})`;
}

export async function withRetry<T>(
    attemptFn: () => Promise<T>,
    { classify, onRetry, sleep, random = Math.random }: RetryOptions,
): Promise<T> {
    for (let attempt = 1; ; attempt += 1) {
        try {
            return await attemptFn();
        } catch (error) {
            const decision =
                attempt < MAX_ATTEMPTS ? classify(error) : undefined;
            const delay =
                decision === undefined
                    ? undefined
                    : computeDelay(attempt, decision.hint?.ms, random);
            if (decision === undefined || delay === undefined) {
                throw error;
            }
            onRetry({ error, attempt: attempt + 1, delay, decision });
            await sleep(delay);
        }
    }
}
