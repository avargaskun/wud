// @ts-nocheck
import { Gauge, register  } from 'prom-client';

let watchContainerGauge;

function init() {
    // Replace gauge if init is called more than once
    if (watchContainerGauge) {
        register.removeSingleMetric(watchContainerGauge.name);
    }
    watchContainerGauge = new Gauge({
        name: 'wud_watcher_total',
        help: 'The number of watched containers',
        labelNames: ['type', 'name'],
    });
}

function getWatchContainerGauge() {
    return watchContainerGauge;
}

export {
    init,
    getWatchContainerGauge,
};
export default {
    init,
    getWatchContainerGauge,
};
