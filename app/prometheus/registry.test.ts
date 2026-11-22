// @ts-nocheck
import * as registry from './registry';

test('registry histogram should be properly configured', async () => {
    registry.init();
    const summary = registry.getSummaryTags();
    expect(summary.name).toStrictEqual('wud_registry_response');
    expect(summary.labelNames).toStrictEqual(['type', 'name']);
});

test('registry retry counter should be properly configured', async () => {
    registry.init();
    const counter = registry.getRetryCounter();
    expect(counter.name).toStrictEqual('wud_registry_retry_count');
    expect(counter.labelNames).toStrictEqual(['type', 'name', 'status']);
});

test('init should replace the metrics when called more than once', async () => {
    registry.init();
    const firstCounter = registry.getRetryCounter();
    const firstSummary = registry.getSummaryTags();
    registry.init();
    expect(registry.getRetryCounter()).not.toBe(firstCounter);
    expect(registry.getSummaryTags()).not.toBe(firstSummary);
});
