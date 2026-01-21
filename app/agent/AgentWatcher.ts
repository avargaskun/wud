import Watcher from '../watchers/Watcher';
import { Container } from '../model/container';

/**
 * Agent Watcher.
 * Acts as a proxy for the remote watcher running on the agent.
 */
class AgentWatcher extends Watcher {
    /**
     * Watch main method.
     * Stubbed out as this watcher delegates to the agent.
     */
    async watch(): Promise<any[]> {
        return [];
    }

    /**
     * Watch a Container.
     * Stubbed out as this watcher delegates to the agent.
     */
    async watchContainer(container: Container): Promise<any> {
        return Promise.resolve(container);
    }

    /**
     * Configuration schema.
     * Relaxed validation since the agent has already validated the config.
     */
    getConfigurationSchema() {
        return this.joi.object().unknown();
    }
}

export default AgentWatcher;
