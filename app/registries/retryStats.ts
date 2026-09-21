let retryCount = 0;

export function recordRetry(): void {
    retryCount += 1;
}

export function getRetryCount(): number {
    return retryCount;
}
