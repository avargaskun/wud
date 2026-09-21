import { getRetryCount, recordRetry } from './retryStats';

test('recordRetry should increase the process-wide count by one', () => {
    const before = getRetryCount();
    recordRetry();
    recordRetry();
    expect(getRetryCount() - before).toBe(2);
});
