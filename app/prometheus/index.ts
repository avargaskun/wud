// @ts-nocheck
import { collectDefaultMetrics, register  } from 'prom-client';

import logger from '../log';
const log = logger.child({ component: 'prometheus' });
import container from './container';
import trigger from './trigger';
import watcher from './watcher';
import registry from './registry';

/**
 * Start the Prometheus registry.
 */
function init() {
    log.info('Init Prometheus module');
    collectDefaultMetrics();
    container.init();
    registry.init();
    trigger.init();
    watcher.init();
}

/**
 * Return all metrics as string for Prometheus scrapping.
 * @returns {string}
 */
async function output() {
    return register.metrics();
}

export {
    init,
    output,
};
export default {
    init,
    output,
};
