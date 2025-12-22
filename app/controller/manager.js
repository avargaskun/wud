const log = require('../log').child({ component: 'controller' });
const { getConfiguration } = require('../configuration');
const AgentClient = require('./client');

const agents = {};

function init() {
    const config = getConfiguration();
    const agentConfigs = config.agent_endpoints || {}; // mapped from WUD_AGENT_{NAME}_*

    Object.keys(agentConfigs).forEach(agentName => {
        const agentConfig = agentConfigs[agentName];
        log.info(`Initializing agent connection: ${agentName}`);
        const client = new AgentClient(agentName, agentConfig);
        agents[agentName] = client;
        client.start();
    });
}

function getAgentsStatus() {
    return Object.keys(agents).map(name => ({
        name,
        connected: agents[name].connected,
        url: `${agents[name].config.host}:${agents[name].config.port}`
    }));
}

// Trigger proxying
// When user clicks "update" on UI for a remote container, it calls the API.
// The API calls the Trigger.
// We need a Trigger provider that proxies to the Agent.
// For now, we assume standard triggers run on Controller.
// BUT requirement: "Agents allow triggers... like updating docker-compose files"
// So we need to proxy DOCKER and DOCKERCOMPOSE triggers to the Agent.

async function triggerRemoteAction(agentName, triggerType, container) {
    const client = agents[agentName];
    if (client && client.connected) {
        client.socket.emit('trigger-update', {
            triggerType,
            container
        });
        return true;
    }
    return false;
}

module.exports = {
    init,
    getAgentsStatus,
    triggerRemoteAction
};
