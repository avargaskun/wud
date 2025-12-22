const log = require('../log').child({ component: 'agent' });
const { Server } = require("socket.io");
const storeContainer = require('../store/container');
const event = require('../event');
const { getConfiguration } = require('../configuration');

let io;

/**
 * Handle incoming connection
 */
function handleConnection(socket) {
    log.info(`New connection from ${socket.handshake.address}`);

    // Initial sync: send all local containers to the controller
    const containers = storeContainer.getContainers();
    socket.emit('sync', containers);

    // Listen for trigger requests from Controller
    socket.on('trigger-update', async (data) => {
        log.info(`Received trigger request for container ${data.container.id} (${data.triggerType})`);
    });

    socket.on('disconnect', () => {
        log.info(`Disconnected ${socket.handshake.address}`);
    });
}

/**
 * Init Agent Server
 */
function init(server) {
    const config = getConfiguration();
    const secret = config.agent.secret;

    io = new Server(server, {
        path: '/socket.io',
        serveClient: false,
    });

    // Auth Middleware
    io.use((socket, next) => {
        const headerSecret = socket.handshake.headers['x-wud-secret'];
        if (headerSecret === secret) {
            next();
        } else {
            log.warn(`Authentication failed for ${socket.handshake.address}`);
            next(new Error("Authentication error"));
        }
    });

    io.on('connection', handleConnection);

    // Listen to local container changes and push to connected controllers
    event.registerContainerReport((event) => {
        // event.container is the container object
        // event.changed is boolean
        io.emit('container-update', event.container);
    });
}

module.exports = {
    init
};
