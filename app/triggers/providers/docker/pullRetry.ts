import {
    RetryDecision,
    isRetryableStatus,
    parseDurationHint,
} from '../../../registries/retry';
import { PullError } from './errors';

const THROTTLED_PATTERN = /toomanyrequests/i;
const UPSTREAM_STATUS_PATTERN =
    /HTTP status:?\s*(502|503|504)\b|\b(502|503|504) (?:Bad Gateway|Service Unavailable|Gateway Timeout)\b/;

interface DockerodeErrorShape {
    statusCode?: unknown;
    json?: unknown;
    message?: unknown;
}

function getErrorText({ json, message }: DockerodeErrorShape): string {
    if (typeof json === 'object' && json !== null) {
        const jsonMessage = (json as { message?: unknown }).message;
        if (typeof jsonMessage === 'string') {
            return jsonMessage;
        }
    }
    return typeof message === 'string' ? message : '';
}

function statusFromText(text: string): number | undefined {
    if (THROTTLED_PATTERN.test(text)) {
        return 429;
    }
    const match = UPSTREAM_STATUS_PATTERN.exec(text);
    const status = match?.[1] ?? match?.[2];
    return status === undefined ? undefined : Number(status);
}

export function classifyPullError(error: unknown): RetryDecision | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }
    const shape = error as DockerodeErrorShape;
    const { statusCode } = shape;
    if (typeof statusCode !== 'number' && !(error instanceof PullError)) {
        return undefined;
    }
    const text = getErrorText(shape);
    const status =
        typeof statusCode === 'number' && isRetryableStatus(statusCode)
            ? statusCode
            : statusFromText(text);
    if (status === undefined) {
        return undefined;
    }
    const ms = parseDurationHint(text);
    return {
        status,
        hint: ms === undefined ? undefined : { ms, source: 'message' },
    };
}
