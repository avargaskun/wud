import fs from 'fs';
import https from 'https';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import logger from '../log';
import * as storeContainer from '../store/container';
import * as event from '../event';
import { getServerConfiguration, getVersion } from '../configuration';
import * as registry from '../registry';
import * as triggerApi from '../api/trigger';
import { Container } from '../model/container';
import { mapComponentsToList } from '../api/component';

const log = logger.child({ component: 'agent-server' });

interface SseClient {
    id: number;
    res: Response;
}

// SSE Clients
let sseClients: SseClient[] = [];
let cachedSecret: string | undefined;

/**
 * Send SSE event to all clients.
 * @param eventName
 * @param data
 */
function sendSseEvent(eventName: string, data: any) {
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
event.registerContainerAdded((container: Container) =>
    sendSseEvent('wud:container-added', container),
);
event.registerContainerUpdated((container: Container) =>
    sendSseEvent('wud:container-updated', container),
);
event.registerContainerRemoved((container: Container) =>
    sendSseEvent('wud:container-removed', { id: container.id }),
);

/**
 * Authenticate Middleware.
 */
function authenticate(req: Request, res: Response, next: NextFunction) {
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
function getContainers(req: Request, res: Response) {
    const containers = storeContainer.getContainers();
    res.json(containers);
}

/**
 * Get Watchers.
 */
function getWatchers(req: Request, res: Response) {
    const localWatchers = registry.getState().watcher;
    const items = mapComponentsToList(localWatchers);
    res.json(items);
}

/**
 * Get Triggers.
 */
function getTriggers(req: Request, res: Response) {
    const localTriggers = registry.getState().trigger;
    const items = mapComponentsToList(localTriggers);
    res.json(items);
}

/**
 * Subscribe to Events (SSE).
 */
function subscribeEvents(req: Request, res: Response) {
    log.info(`Controller WUD with ip ${req.ip} connected.`);

    const headers = {
        'Content-Type': 'text/event-stream',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
    };
    res.writeHead(200, headers);

    const client: SseClient = {
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
 * Watch a specific watcher.
 */
async function watchWatcher(req: Request, res: Response) {
    const { type, name } = req.params;
    const watcherId = `${type.toLowerCase()}.${name.toLowerCase()}`;
    const watcher = registry.getState().watcher[watcherId];

    if (!watcher) {
        return res.status(404).json({ error: `Watcher ${name} not found` });
    }

    try {
        const results = await watcher.watch();
        res.json(results);
    } catch (e: any) {
        log.error(`Error watching watcher ${name}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
}

/**
 * Watch a specific container.
 */
async function watchContainer(req: Request, res: Response) {
    const { type, name, id } = req.params;
    const watcherId = `${type.toLowerCase()}.${name.toLowerCase()}`;
    const watcher = registry.getState().watcher[watcherId];

    if (!watcher) {
        return res.status(404).json({ error: `Watcher ${name} not found` });
    }

    const container = storeContainer.getContainer(id);
    if (!container) {
        return res
            .status(404)
            .json({ error: `Container ${id} not found in agent store` });
    }

    try {
        const result = await watcher.watchContainer(container);
        res.json(result);
    } catch (e: any) {
        log.error(`Error watching container ${id}: ${e.message}`);
        res.status(500).json({ error: e.message });
    }
}

/**
 * Run Remote Trigger.
 * Delegates to the common API handler but ensures no proxying happens.
 */
async function runTrigger(req: Request, res: Response) {
    if (req.body && req.body.agent) {
        delete req.body.agent;
    }
    return triggerApi.runTrigger(req, res);
}

/**
 * Run Remote Trigger Batch.
 */
async function runTriggerBatch(req: Request, res: Response) {
    const { type, name } = req.params;
    const containers = req.body;

    if (!Array.isArray(containers)) {
        return res
            .status(400)
            .json({ error: 'Body must be an array of containers' });
    }

    const triggerId = `${type}.${name}`;
    const trigger = registry.getState().trigger[triggerId];

    if (!trigger) {
        return res.status(404).json({ error: `Trigger ${name} not found` });
    }

    try {
        const sanitizedContainers = containers.map((container) => {
            if (container.agent) {
                delete container.agent;
            }
            return container;
        });
        await trigger.triggerBatch(sanitizedContainers);
        res.status(200).json({});
    } catch (e: any) {
        log.error(`Error running batch trigger ${name}: ${e.message}`);
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
        } catch (e: any) {
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
    app.get('/api/triggers', getTriggers);
    app.get('/api/events', subscribeEvents);
    app.post('/api/triggers/:type/:name', runTrigger);
    app.post('/api/triggers/:type/:name/batch', runTriggerBatch);
    app.post('/api/watchers/:type/:name', watchWatcher);
    app.post('/api/watchers/:type/:name/container/:id', watchContainer);

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
