import { AgentClient, AgentClientConfig } from './AgentClient';
import log from '../log';
import { getState } from '../registry';

const clients: AgentClient[] = [];

export function getAgents(): AgentClient[] {
    return clients;
}

export function getAgent(name: string): AgentClient | undefined {
    return clients.find((client) => client.name === name);
}

export async function init(): Promise<void> {
    const registryState = getState();
    const agents = registryState.agent;

    Object.keys(agents).forEach((agentId) => {
        const agentComponent = agents[agentId];
        const name = agentComponent.name;
        const config = agentComponent.configuration as AgentClientConfig;

        if (!config.host || !config.secret) {
            log.warn(`Skipping agent ${name}: Missing host or secret`);
            return;
        }

        const client = new AgentClient(name, config);
        clients.push(client);
        // Start without awaiting to not block main init
        client.init();
    });
}
