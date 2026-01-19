import { AgentClient, AgentClientConfig } from './AgentClient';
import log from '../log';
import fs from 'fs';

const clients: AgentClient[] = [];

export function getAgents(): AgentClient[] {
    return clients;
}

export function getAgent(name: string): AgentClient | undefined {
    return clients.find((client) => client.name === name);
}

interface AgentConfigInternal extends Partial<AgentClientConfig> {
    name: string;
    secret_file?: string;
}

export async function init(): Promise<void> {
    const env = process.env;
    const agents: Record<string, AgentConfigInternal> = {};

    Object.keys(env).forEach((key) => {
        // Filter out the generic Agent mode config variables
        if (key === 'WUD_AGENT_SECRET' || key === 'WUD_AGENT_SECRET_FILE') {
            return;
        }

        if (key.startsWith('WUD_AGENT_')) {
            const parts = key.split('_');
            // Expected: WUD, AGENT, NAME, PROP...
            if (parts.length < 4) {
                return;
            }

            const name = parts[2].toLowerCase();
            const prop = parts.slice(3).join('_').toLowerCase(); // HOST, SECRET, etc.

            if (!agents[name]) {
                agents[name] = { name };
            }

            const value = env[key];
            if (value === undefined) {
                return;
            }

            // Map prop to config
            if (prop === 'host') {
                agents[name].host = value;
            }
            if (prop === 'port') {
                agents[name].port = parseInt(value, 10);
            }
            if (prop === 'secret') {
                agents[name].secret = value;
            }
            if (prop === 'secret_file') {
                agents[name].secret_file = value;
            }
            if (prop === 'cafile') {
                agents[name].cafile = value;
            }
            if (prop === 'certfile') {
                agents[name].certfile = value;
            }
            if (prop === 'keyfile') {
                agents[name].keyfile = value;
            }
        }
    });

    // Initialize clients
    for (const name of Object.keys(agents)) {
        const config = agents[name];

        // Resolve secret file
        if (config.secret_file) {
            try {
                config.secret = fs
                    .readFileSync(config.secret_file, 'utf-8')
                    .trim();
            } catch (e: any) {
                log.error(
                    `Failed to read secret file for agent ${name}: ${e.message}`,
                );
                continue;
            }
        }

        if (!config.host || !config.secret) {
            log.warn(`Skipping agent ${name}: Missing host or secret`);
            continue;
        }

        const client = new AgentClient(name, config as AgentClientConfig);
        clients.push(client);
        // Start without awaiting to not block main init
        client.init();
    }
}
