// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import * as component from './component';
import * as registry from '../registry';
import * as agent from '../agent';
import logger from '../log';

const log = logger.child({ component: 'trigger' });

/**
 * Get all triggers (local + remote).
 */
function getAll(req, res) {
    // Local
    const localTriggers = registry.getState().trigger;
    const items = component.mapComponentsToList(localTriggers);

    // Remote
    const agents = agent.getAgents();
    for (const agentClient of agents) {
        if (agentClient.isConnected) {
            const remoteTriggers = agentClient.triggers.map((t) => ({
                ...t,
                agent: agentClient.name,
            }));
            items.push(...remoteTriggers);
        }
    }
    res.json(items);
}

/**
 * Get a local trigger by id.
 */
function getLocal(req, res) {
    const { type, name } = req.params;
    const id = `${type}.${name}`;
    const trigger = registry.getState().trigger[id];
    if (trigger) {
        res.status(200).json(component.mapComponentToItem(id, trigger));
    } else {
        res.sendStatus(404);
    }
}

/**
 * Get a remote trigger.
 */
function getRemote(req, res) {
    const { agent: agentName, type, name } = req.params;
    const agentClient = agent.getAgent(agentName);
    if (!agentClient) {
        res.sendStatus(404);
        return;
    }
    const trigger = agentClient.triggers.find(
        (t) => t.type === type && t.name === name,
    );
    if (trigger) {
        res.json({
            ...trigger,
            agent: agentName,
        });
    } else {
        res.sendStatus(404);
    }
}

/**
 * Run a specific trigger on a specific container provided in the payload.
 */
export async function runTrigger(req, res) {
    const triggerType = req.params.type;
    const triggerName = req.params.name;
    const containerToTrigger = req.body;

    if (!containerToTrigger) {
        log.warn(
            `Trigger cannot be executed without container (type=${triggerType}, name=${triggerName})`,
        );
        res.status(400).json({
            error: `Error when running trigger ${triggerType}.${triggerName} (container is undefined)`,
        });
        return;
    }

    // Running local triggers on remote containers is not supported
    if (containerToTrigger.agent) {
        log.warn(
            `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`
        );
        res.status(400).json({
            error: `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`
        });
        return;
    }

    const triggerToRun =
        registry.getState().trigger[`${triggerType}.${triggerName}`];
    if (!triggerToRun) {
        log.warn(`No trigger found(type=${triggerType}, name=${triggerName})`);
        res.status(404).json({
            error: `Error when running trigger ${triggerType}.${triggerName} (trigger not found)`,
        });
        return;
    }

    try {
        await triggerToRun.trigger(containerToTrigger);
        log.info(
            `Trigger executed with success (type=${triggerType}, name=${triggerName}, container=${JSON.stringify(containerToTrigger)})`,
        );
        res.status(200).json({});
    } catch (e) {
        log.warn(
            `Error when running trigger ${triggerType}.${triggerName} (${e.message})`,
        );
        res.status(500).json({
            error: `Error when running trigger ${triggerType}.${triggerName} (${e.message})`,
        });
    }
}

/**
 * Run a specifically targeted remote trigger.
 */
async function runRemoteTrigger(req, res) {
    const {
        agent: agentName,
        type: triggerType,
        name: triggerName,
    } = req.params;
    const containerToTrigger = req.body;

    const agentClient = agent.getAgent(agentName);
    if (!agentClient) {
        res.status(404).json({ error: `Agent ${agentName} not found` });
        return;
    }

    if (!containerToTrigger || !containerToTrigger.id) {
        res.status(400).json({
            error: 'Container with ID is required in body',
        });
        return;
    }

    try {
        await agentClient.runRemoteTrigger(
            containerToTrigger,
            triggerType,
            triggerName,
        );
        log.info(
            `Remote trigger executed with success (agent=${agentName}, type=${triggerType}, name=${triggerName}, container=${containerToTrigger.id})`,
        );
        res.status(200).json({});
    } catch (e) {
        log.warn(
            `Error when running remote trigger ${triggerType}.${triggerName} on agent ${agentName} (${e.message})`,
        );
        res.status(500).json({
            error: `Error when running remote trigger ${triggerType}.${triggerName} on agent ${agentName} (${e.message})`,
        });
    }
}

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
    const router = express.Router();
    router.use(nocache());

    router.get('/', getAll);
    router.get('/:type/:name', getLocal);
    router.post('/:type/:name', runTrigger);

    router.get('/:agent/:type/:name', getRemote);
    router.post('/:agent/:type/:name', runRemoteTrigger);

    return router;
}
