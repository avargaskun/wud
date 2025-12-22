const log = require('../log').child({ component: 'agent' });
const { validateConfiguration } = require('./configuration');

/**
 * Main Agent Entrypoint
 */
async function init() {
    log.info('Starting WUD in Agent Mode');

    // We reuse the main app initialization for Store, API, etc.
    // But we need to make sure specific components are disabled/enabled.
    // This is handled mostly via configuration (e.g. watchers, triggers).

    // The server.js (Socket.IO) will be attached to the HTTP server in app/api/index.js
    // We need to export a way to attach it.
}

module.exports = {
    init
};
