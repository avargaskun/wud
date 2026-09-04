import { Counter, register } from 'prom-client';

type PostupdateBounceLabels = 'type' | 'name' | 'status';

const METRIC_NAME = 'wud_postupdate_bounce_count';

let postupdateBounceCounter: Counter<PostupdateBounceLabels> | undefined;

export function init(): void {
    // Replace counter if init is called more than once
    if (postupdateBounceCounter) {
        register.removeSingleMetric(METRIC_NAME);
    }
    postupdateBounceCounter = new Counter<PostupdateBounceLabels>({
        name: METRIC_NAME,
        help: 'Total count of post-update dependent bounce outcomes',
        labelNames: ['type', 'name', 'status'],
    });
}

export function getPostupdateBounceCounter():
    | Counter<PostupdateBounceLabels>
    | undefined {
    return postupdateBounceCounter;
}
