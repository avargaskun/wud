// @ts-nocheck
import { getVersion  } from './configuration';
import log from './log';
import store from './store';
import registry from './registry';
import api from './api';
import prometheus from './prometheus';

async function main() {
    log.info(`WUD is starting (version = ${getVersion()})`);

    // Init store
    await store.init();

    // Start Prometheus registry
    prometheus.init();

    // Init registry
    await registry.init();

    // Init api
    await api.init();
}
main();
