import fs from 'fs';
import https from 'https';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import logger from '../log';
import * as storeContainer from '../store/container';
import * as event from '../event';
import { getServerConfiguration, getVersion } from '../configuration';
import * as registry from '../registry';

const log = logger.child({ component: 'agent-server' });

// SSE Clients
let sseClients = [];
let cachedSecret: string | undefined;

/**
 * Send SSE event to all clients.
 * @param eventName
 * @param data
 */
function sendSseEvent(eventName, data) {
    const message = {
        type: eventName,
        data: data,
    };
    const payload = JSON.stringify(message);
    sseClients.forEach((client) => {
        client.res.write(`data: ${payload}\n\n`);
    });
}

// Subscribe to store events
event.registerContainerAdded((container) =>
    sendSseEvent('wud:container-added', container),
);
event.registerContainerUpdated((container) =>
    sendSseEvent('wud:container-updated', container),
);
event.registerContainerRemoved((container) =>
    sendSseEvent('wud:container-removed', { id: container.id }),
);

/**
 * Authenticate Middleware.
 */
function authenticate(req, res, next) {
    const requestSecret = req.headers['x-wud-agent-secret'];
    if (!cachedSecret || requestSecret !== cachedSecret) {
        log.warn(`Unauthorized access attempt from ${req.ip}`);
        return res.status(401).send();
    }
    next();
}

/**
 * Get Containers (Handshake).
 */
function getContainers(req, res) {
    const containers = storeContainer.getContainers();
    res.json(containers);
}

/**
 * Get Watchers.
 */
function getWatchers(req, res) {
    const watchers = registry.getState().watcher;
    const maskedWatchers = {};
    Object.keys(watchers).forEach((key) => {
        const component = watchers[key];
        maskedWatchers[key] = {
            id: component.getId(),
            type: component.type,
            name: component.name,
            configuration: component.maskConfiguration(),
        };
    });
    res.json(maskedWatchers);
}

/**
 * Subscribe to Events (SSE).
 */
function subscribeEvents(req, res) {
    log.info(`Controller WUD with ip ${req.ip} connected.`);

    const headers = {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);

    const client = {
        id: Date.now(),
        res,
    };
    sseClients.push(client);

    // Send Welcome / Ack
    const ackMessage = {
        type: 'wud:ack',
        data: { version: getVersion() },
    };
    client.res.write(`data: ${JSON.stringify(ackMessage)}\n\n`);

    req.on('close', () => {
        log.info(`Controller WUD with ip ${req.ip} disconnected.`);
        sseClients = sseClients.filter((c) => c.id !== client.id);
    });
}

/**
 * Run Remote Trigger.
 */
async function runTrigger(req, res) {
    const { id, triggerType, triggerName } = req.params;
    const container = storeContainer.getContainer(id);

    if (!container) {
        log.warn(`Received trigger request for invalid container: ${id}`);
        return res.status(404).json({ error: 'Container not found' });
    }

    // In Agent mode, triggers are loaded from configuration but we need to find the specific one.
    // The Registry holds the registered components.
    const triggerId = `${triggerType}.${triggerName}`;
    const trigger = registry.getState().trigger[triggerId];

    if (!trigger) {
        log.warn(`Received trigger request for invalid trigger: ${triggerId}`);
        return res
            .status(404)
            .json({ error: `Trigger ${triggerId} not found on Agent` });
    }

    try {
        await trigger.trigger(container);
        log.info(`Trigger executed: ${triggerId} for ${container.name}`);
        res.json({ success: true });
    } catch (e) {
        log.error(`Error running trigger ${triggerId}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
}

/**
 * Init Agent Server.
 */
export async function init() {
    cachedSecret = undefined;
    const agentSecret = process.env.WUD_AGENT_SECRET;
    const agentSecretFile = process.env.WUD_AGENT_SECRET_FILE;

    if (agentSecret) {
        cachedSecret = agentSecret;
    } else if (agentSecretFile) {
        try {
            cachedSecret = fs.readFileSync(agentSecretFile, 'utf-8').trim();
        } catch (e) {
            log.error(`Error reading secret file: ${e.message}`);
            throw new Error(`Error reading secret file: ${e.message}`);
        }
    }

    if (!cachedSecret) {
        log.error(
            'WUD Agent mode requires WUD_AGENT_SECRET or WUD_AGENT_SECRET_FILE to be defined.',
        );
        throw new Error(
            'WUD Agent mode requires WUD_AGENT_SECRET or WUD_AGENT_SECRET_FILE',
        );
    }

    const configuration = getServerConfiguration();
    const app = express();

    app.use(bodyParser.json());
    if (configuration.cors.enabled) {
        app.use(
            cors({
                origin: configuration.cors.origin,
                methods: configuration.cors.methods,
            }),
        );
    }

    // Auth Middleware
    app.use(authenticate);

    // Routes
    app.get('/api/containers', getContainers);
    app.get('/api/watchers', getWatchers);
    app.get('/api/events', subscribeEvents);
    app.post(
        '/api/containers/:id/triggers/:triggerType/:triggerName',
        runTrigger,
    );

    // Start Server
    if (configuration.tls.enabled) {
        const options = {
            key: fs.readFileSync(configuration.tls.key),
            cert: fs.readFileSync(configuration.tls.cert),
        };
        https.createServer(options, app).listen(configuration.port, () => {
            log.info(
                `Agent Server listening on port ${configuration.port} (HTTPS)`,
            );
        });
    } else {
        app.listen(configuration.port, () => {
            log.info(
                `Agent Server listening on port ${configuration.port} (HTTP)`,
            );
        });
    }
}
