// @ts-nocheck
import { getVersion, isAgent } from './configuration';
import log from './log';
import * as store from './store';
import * as registry from './registry';
import * as api from './api';
import * as agent from './agent';
import * as prometheus from './prometheus';

async function main() {
    const agentMode = isAgent();
    log.info(`WUD is starting (version = ${getVersion()})`);
    if (agentMode) {
        log.info('Running in AGENT mode');
    }

    // Init store
    await store.init();

    if (!agentMode) {
        // Start Prometheus registry
        prometheus.init();
    }

    // Init registry
    await registry.init();

    if (agentMode) {
        // Init agent
        await agent.init();
    } else {
        // Init api
        await api.init();
    }
}
main();
