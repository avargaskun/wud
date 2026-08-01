import Trigger from '../../triggers/providers/Trigger';
import { Container } from '../../model/container';
import { getAgent } from '../manager';
import { getPostupdateBounceCounter } from '../../prometheus/postupdate';
import type { TriggerRunResult } from '../../triggers/providers/docker/types';

/**
 * Agent Trigger.
 * Acts as a proxy for the remote trigger running on the agent.
 */
class AgentTrigger extends Trigger {
    /**
     * Trigger method.
     * Delegates to the agent.
     */
    async trigger(container: Container): Promise<TriggerRunResult | void> {
        const client = this.getAgentClient();
        const result = await client.runRemoteTrigger(
            container,
            this.type,
            this.name,
        );
        this.countRemoteDependents(result);
        return result;
    }

    /**
     * Trigger batch method.
     * Delegates to the agent.
     */
    async triggerBatch(
        containers: Container[],
    ): Promise<TriggerRunResult | void> {
        const client = this.getAgentClient();
        const result = await client.runRemoteTriggerBatch(
            containers,
            this.type,
            this.name,
        );
        this.countRemoteDependents(result);
        return result;
    }

    /**
     * Resolve the agent client this trigger proxies to.
     */
    private getAgentClient() {
        const agentName = this.agent;
        if (!agentName) {
            throw new Error('AgentTrigger must have an agent assigned');
        }
        const client = getAgent(agentName);
        if (!client) {
            throw new Error(`Agent ${agentName} not found`);
        }
        return client;
    }

    /**
     * Count agent-executed dependent bounces on the controller.
     * The agent-side increment is a no-op (Prometheus is controller-only), so there is no double count.
     */
    private countRemoteDependents(result: TriggerRunResult | undefined): void {
        const counter = getPostupdateBounceCounter();
        if (!counter) {
            return;
        }
        (result?.dependents ?? []).forEach((dependent) => {
            counter.inc({
                type: this.type,
                name: this.name,
                status: dependent.status,
            });
        });
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
