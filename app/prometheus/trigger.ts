// @ts-nocheck
import { Counter, register  } from 'prom-client';

let triggerCounter;

function init() {
    // Replace counter if init is called more than once
    if (triggerCounter) {
        register.removeSingleMetric(triggerCounter.name);
    }
    triggerCounter = new Counter({
        name: 'wud_trigger_count',
        help: 'Total count of trigger events',
        labelNames: ['type', 'name', 'status'],
    });
}

function getTriggerCounter() {
    return triggerCounter;
}

export {
    init,
    getTriggerCounter,
};
export default {
    init,
    getTriggerCounter,
};
