// @ts-nocheck
import Trigger from '../triggers/providers/Trigger';
import { Container } from '../model/container';

/**
 * Agent Trigger.
 * Acts as a proxy for the remote trigger running on the agent.
 */
class AgentTrigger extends Trigger {
    /**
     * Trigger method.
     * Stubbed out as this trigger delegates to the agent.
     */
    async trigger(container: Container): Promise<any> {
        return Promise.resolve(container);
    }

    /**
     * Trigger batch method.
     * Stubbed out as this trigger delegates to the agent.
     */
    async triggerBatch(containers: Container[]): Promise<any> {
        return Promise.resolve(containers);
    }

    /**
     * Configuration schema.
     * Relaxed validation since the agent has already validated the config.
     */
    getConfigurationSchema() {
        return this.joi.object().unknown();
    }
}

export default AgentTrigger;
