import { AgentClient } from './AgentClient';
import log from '../log';
import fs from 'fs';

const clients = [];

export function getAgents() {
    return clients;
}

export function getAgent(name) {
    return clients.find(client => client.name === name);
}

export async function init() {
    const env = process.env;
    const agents = {};

    Object.keys(env).forEach(key => {
        // Filter out the generic Agent mode config variables
        if (key === 'WUD_AGENT_SECRET' || key === 'WUD_AGENT_SECRET_FILE') return;

        if (key.startsWith('WUD_AGENT_')) {
            const parts = key.split('_');
            // Expected: WUD, AGENT, NAME, PROP...
            if (parts.length < 4) return;
            
            const name = parts[2].toLowerCase();
            const prop = parts.slice(3).join('_').toLowerCase(); // HOST, SECRET, etc.
            
            if (!agents[name]) agents[name] = { name };
            
            // Map prop to config
            if (prop === 'host') agents[name].host = env[key];
            if (prop === 'port') agents[name].port = parseInt(env[key], 10);
            if (prop === 'secret') agents[name].secret = env[key];
            if (prop === 'secret_file') agents[name].secret_file = env[key];
            if (prop === 'cafile') agents[name].cafile = env[key];
            if (prop === 'certfile') agents[name].certfile = env[key];
            if (prop === 'keyfile') agents[name].keyfile = env[key];
        }
    });

    // Initialize clients
    for (const name of Object.keys(agents)) {
        const config = agents[name];
        
        // Resolve secret file
        if (config.secret_file) {
            try {
                config.secret = fs.readFileSync(config.secret_file, 'utf-8').trim();
            } catch (e) {
                log.error(`Failed to read secret file for agent ${name}: ${e.message}`);
                continue;
            }
        }

        if (!config.host || !config.secret) {
            log.warn(`Skipping agent ${name}: Missing host or secret`);
            continue;
        }

        const client = new AgentClient(name, config);
        clients.push(client);
        // Start without awaiting to not block main init
        client.init(); 
    }
}
