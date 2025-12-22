const log = require('../log').child({ component: 'controller' });
const { io } = require("socket.io-client");
const storeContainer = require('../store/container');
const event = require('../event');

class AgentClient {
    constructor(name, config) {
        this.name = name;
        this.config = config;
        this.socket = null;
        this.connected = false;
    }

    start() {
        const url = `${this.config.host}:${this.config.port}`;
        const protocol = this.config.tls ? 'https' : 'http';
        const fullUrl = `${protocol}://${url}`;

        log.info(`Connecting to agent ${this.name} at ${fullUrl}`);

        this.socket = io(fullUrl, {
            path: '/socket.io',
            reconnection: true,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 30000,
            extraHeaders: {
                "x-wud-secret": this.config.secret
            },
            ...(this.config.cafile ? { ca: require('fs').readFileSync(this.config.cafile) } : {}),
            ...(this.config.certfile ? { cert: require('fs').readFileSync(this.config.certfile) } : {}),
            ...(this.config.keyfile ? { key: require('fs').readFileSync(this.config.keyfile) } : {}),
        });

        this.socket.on('connect', () => {
            log.info(`Connected to agent ${this.name}`);
            this.connected = true;
        });

        this.socket.on('disconnect', () => {
            log.warn(`Disconnected from agent ${this.name}`);
            this.connected = false;
        });

        this.socket.on('connect_error', (err) => {
            log.error(`Connection error with agent ${this.name}: ${err.message}`);
        });

        this.socket.on('sync', (containers) => {
            log.info(`Received sync from agent ${this.name} (${containers.length} containers)`);
            containers.forEach(c => this.processRemoteContainer(c));
        });

        this.socket.on('container-update', (container) => {
            log.debug(`Received update for container ${container.id} from agent ${this.name}`);
            this.processRemoteContainer(container);
        });
    }

    async processRemoteContainer(remoteContainer) {
        // We need to transform the container to indicate it comes from an agent
        // The unique ID should probably include the agent name to avoid collisions
        // But WUD uses 'id' as the docker ID. If we change it, it might break things.
        // However, collisions are possible if multiple agents monitor same ID (unlikely usually, but possible).
        // Let's modify the watcher name to include agent name: "watcher (agent)"

        const localContainer = JSON.parse(JSON.stringify(remoteContainer));

        // Tag the container with agent info
        localContainer.agent = this.name;
        localContainer.watcher = `${localContainer.watcher} (${this.name})`;
        localContainer.displayName = `${localContainer.displayName || localContainer.name} (${this.name})`;

        // Trigger logic:
        // Remote containers should show remote triggers.
        // We need to map triggers to "proxy" triggers if we want to execute them.

        // Persist to local store
        const containerInDb = storeContainer.getContainer(localContainer.id);

        if (!containerInDb) {
            storeContainer.insertContainer(localContainer);
        } else {
            storeContainer.updateContainer(localContainer);
        }

        // Emit event so the Controller performs version check (registry check)
        // The Agent sends current version, but NOT new version (Agent Mode logic).
        // Controller must check for updates.

        // We can reuse the standard Watcher logic?
        // Or we treat this as a "report".

        // The standard Docker watcher emits 'container.report'.
        // If we just save it, the Registries won't run automatically unless we trigger them.
        // Actually, WUD architecture is: Watcher -> emits report -> Event loop -> ? -> Triggers?
        // Wait, version checking happens IN the watcher usually (Docker.js findNewVersion).

        // Requirement: "Agent sends information... Controller then performs a version check"
        // So we need to actively perform version check here.

        try {
            // We need a way to invoke the ImageVersionService or similar.
            // But we don't have the `Docker` component instance here easily.
            // We can use the ImageVersionService directly if we import it.

            const ImageVersionService = require('../registry/ImageVersionService');
            const registry = require('../registry'); // to get providers

            // We need a logger
            const logChild = log.child({ container: localContainer.name });

            // Registry check
            // We need to support standard registry providers loaded in Controller
            const result = await ImageVersionService.findNewVersion(
                localContainer,
                logChild,
                registry.getState().registry[localContainer.image.registry.name],
                null // no dockerApi for remote
            );

            localContainer.result = result;

            // Check if changed
             const containerInDb = storeContainer.getContainer(localContainer.id);
             let changed = false;

             if (!containerInDb) {
                 storeContainer.insertContainer(localContainer);
                 changed = true;
             } else {
                 storeContainer.updateContainer(localContainer);
                 // Simple change detection
                 changed = JSON.stringify(containerInDb.result) !== JSON.stringify(result);
             }

             if (changed) {
                 event.emitContainerReport({
                     container: localContainer,
                     changed: true
                 });
             }

        } catch (e) {
            log.warn(`Error checking version for remote container ${localContainer.name}: ${e.message}`);
        }
    }
}

module.exports = AgentClient;
