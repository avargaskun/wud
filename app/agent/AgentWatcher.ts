import Watcher from '../watchers/Watcher';
import { Container } from '../model/container';
import { getAgent } from './manager';

/**
 * Agent Watcher.
 * Acts as a proxy for the remote watcher running on the agent.
 */
class AgentWatcher extends Watcher {
    /**
     * Watch main method.
     * Returns empty as the agent pushes updates via SSE.
     */
    async watch(): Promise<any[]> {
        const agentName = this.agent;
        if (!agentName) {
            throw new Error('AgentWatcher must have an agent assigned');
        }
        const client = getAgent(agentName);
        if (!client) {
            throw new Error(`Agent ${agentName} not found`);
        }
        // Agent updates are pushed via SSE, so we don't need to poll here.
        // However, we ensure the client is known.
        return [];
    }

    /**
     * Watch a Container.
     * No-op for now as we don't have a specific "watch container" API on the agent yet.
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
