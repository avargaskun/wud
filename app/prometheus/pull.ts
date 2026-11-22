import { Counter, register } from 'prom-client';

type PullRetryLabels = 'type' | 'name' | 'status';

const METRIC_NAME = 'wud_trigger_pull_retry_count';

let pullRetryCounter: Counter<PullRetryLabels> | undefined;

export function init(): void {
    // Replace counter if init is called more than once
    if (pullRetryCounter) {
        register.removeSingleMetric(METRIC_NAME);
    }
    pullRetryCounter = new Counter<PullRetryLabels>({
        name: METRIC_NAME,
        help: 'Total count of image pulls retried after a throttled or transient response',
        labelNames: ['type', 'name', 'status'],
    });
}

export function getPullRetryCounter(): Counter<PullRetryLabels> | undefined {
    return pullRetryCounter;
}
