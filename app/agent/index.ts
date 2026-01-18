// @ts-nocheck
import logger from '../log';
const log = logger.child({ component: 'agent' });
import { getAgentModeConfiguration } from '../configuration';
import * as server from './server';

export async function init() {
    log.info('Starting Agent mode...');
    const config = getAgentModeConfiguration();

    // Validate secret
    if (!config.secret) {
        log.error('Agent mode requires WUD_AGENT_SECRET (or FILE) to be configured.');
        process.exit(1);
    }

    // Init Server
    await server.init();
}
