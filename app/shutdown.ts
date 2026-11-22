import log from './log';
import * as registry from './registry';
import * as store from './store';

const FORCED_EXIT_DELAY_MS = 5000;

let shuttingDown = false;

/**
 * Deregister all components, flush the store and exit.
 */
export async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (shuttingDown) {
        log.warn(`Received ${signal} during shutdown, exiting now`);
        process.exit(1);
        return;
    }
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down`);

    const forcedExit = setTimeout(() => {
        log.error(
            `Shutdown did not complete within ${FORCED_EXIT_DELAY_MS}ms, exiting now`,
        );
        process.exit(1);
    }, FORCED_EXIT_DELAY_MS);

    let exitCode = 0;
    try {
        await registry.deregisterAll();
    } catch (e: unknown) {
        log.error(`Shutdown: ${(e as Error).message}`);
        exitCode = 1;
    }
    try {
        await store.close();
    } catch (e: unknown) {
        log.error(
            `Shutdown: error when closing the store (${(e as Error).message})`,
        );
        exitCode = 1;
    }

    clearTimeout(forcedExit);
    log.info('Shutdown complete');
    process.exit(exitCode);
}

export function registerShutdownHandlers(): void {
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
