// @ts-nocheck
import fs from 'fs';
import https from 'https';
import express from 'express';
import bodyParser from 'body-parser';
import logger from '../log';
const log = logger.child({ component: 'agent-server' });
import { getServerConfiguration, getAgentModeConfiguration } from '../configuration';
import * as healthRouter from '../api/health';
import { getContainers, getContainer } from '../store/container';
import { getState } from '../registry';
import * as event from '../event';

const configuration = getServerConfiguration();
const agentConfiguration = getAgentModeConfiguration();

const authMiddleware = (req, res, next) => {
    const secret = req.header('X-Wud-Agent-Secret');
    if (secret !== agentConfiguration.secret) {
        log.warn(`Unauthorized access attempt from ${req.ip}`);
        res.sendStatus(401);
        return;
    }
    next();
};

export async function init() {
    if (configuration.enabled) {
        log.info(`Start Agent Server on port ${configuration.port}`);
        const app = express();
        app.set('trust proxy', true);
        app.use(bodyParser.json());

        // Healthcheck (public)
        app.use('/health', healthRouter.init());

        const api = express.Router();
        api.use(authMiddleware);

        // Snapshot
        api.get('/containers', (req, res) => {
            res.json(getContainers());
        });

        api.get('/watchers', (req, res) => {
            const watchers = Object.values(getState().watcher).map((watcher) => ({
                id: watcher.getId(),
                name: watcher.name,
                type: watcher.type,
                configuration: watcher.maskConfiguration(),
            }));
            res.json(watchers);
        });

        // SSE
        api.get('/events', (req, res) => {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();

            const send = (type, data) => {
                res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
            };

            const onAdded = (c) => send('added', c);
            const onUpdated = (c) => send('updated', c);
            const onRemoved = (c) => send('removed', c);

            event.registerContainerAdded(onAdded);
            event.registerContainerUpdated(onUpdated);
            event.registerContainerRemoved(onRemoved);

            req.on('close', () => {
                event.unregisterContainerAdded(onAdded);
                event.unregisterContainerUpdated(onUpdated);
                event.unregisterContainerRemoved(onRemoved);
            });
        });

        // Triggers
        api.post('/triggers/:type/:name/:containerId', async (req, res) => {
            const { type, name, containerId } = req.params;
            const container = getContainer(containerId);
            if (!container) {
                res.status(404).json({ error: 'Container not found' });
                return;
            }
            const triggerId = `${type}.${name}`;
            const trigger = getState().trigger[triggerId];
            if (!trigger) {
                res.status(404).json({ error: 'Trigger not found' });
                return;
            }
            try {
                await trigger.trigger(container);
                res.status(200).json({ status: 'ok' });
            } catch (e) {
                log.error(`Error running trigger ${triggerId}: ${e.message}`);
                res.status(500).json({ error: e.message });
            }
        });

        app.use('/api', api);

        if (configuration.tls.enabled) {
            let serverKey;
            let serverCert;
            try {
                serverKey = fs.readFileSync(configuration.tls.key);
            } catch (e) {
                log.error(
                    `Unable to read the key file under ${configuration.tls.key} (${e.message})`,
                );
                throw e;
            }
            try {
                serverCert = fs.readFileSync(configuration.tls.cert);
            } catch (e) {
                log.error(
                    `Unable to read the cert file under ${configuration.tls.cert} (${e.message})`,
                );
                throw e;
            }
            https
                .createServer({ key: serverKey, cert: serverCert }, app)
                .listen(configuration.port, () => {
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
}
