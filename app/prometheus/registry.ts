import { Counter, Summary, register } from 'prom-client';

const SUMMARY_NAME = 'wud_registry_response';
const RETRY_COUNTER_NAME = 'wud_registry_retry_count';

let summaryGetTags: Summary<'type' | 'name'> | undefined;
let retryCounter: Counter<'type' | 'name' | 'status'> | undefined;

export function init(): void {
    // Replace metrics if init is called more than once
    if (summaryGetTags) {
        register.removeSingleMetric(SUMMARY_NAME);
    }
    if (retryCounter) {
        register.removeSingleMetric(RETRY_COUNTER_NAME);
    }
    summaryGetTags = new Summary({
        name: SUMMARY_NAME,
        help: 'The Registry response time (in second)',
        labelNames: ['type', 'name'],
    });
    retryCounter = new Counter({
        name: RETRY_COUNTER_NAME,
        help: 'Total count of registry requests retried after a throttled or transient response',
        labelNames: ['type', 'name', 'status'],
    });
}

export function getSummaryTags(): Summary<'type' | 'name'> | undefined {
    return summaryGetTags;
}

export function getRetryCounter():
    | Counter<'type' | 'name' | 'status'>
    | undefined {
    return retryCounter;
}
