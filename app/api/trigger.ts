import { Request, Response, Router } from 'express';
import * as component from './component';
import * as registry from '../registry';
import * as agent from '../agent';
import logger from '../log';
import { ContainerGoneError } from '../triggers/providers/docker/errors';
import { RemoteTriggerError } from '../agent/errors';
import type { TriggerRunResult } from '../triggers/providers/docker/types';

const log = logger.child({ component: 'trigger' });

/**
 * Run a specific trigger on a specific container provided in the payload.
 */
export async function runTrigger(req: Request, res: Response): Promise<void> {
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
            `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
        );
        res.status(400).json({
            error: `Cannot execute local trigger ${triggerType}.${triggerName} on remote container ${containerToTrigger.agent}.${containerToTrigger.id}`,
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
        log.debug(
            `Running trigger ${triggerType}.${triggerName} (container=${JSON.stringify(
                containerToTrigger,
            )})`,
        );
        const unprocessable = await triggerToRun.getUnprocessableContainers([
            containerToTrigger,
        ]);
        if (unprocessable.length > 0) {
            const [{ reason }] = unprocessable;
            log.warn(
                `Trigger cannot be applied (type=${triggerType}, name=${triggerName}, container=${containerToTrigger.name}, reason=${reason})`,
            );
            res.status(400).json({
                error: `Container ${containerToTrigger.name} cannot be updated by this trigger (${reason})`,
                containers: [containerToTrigger.id],
                details: unprocessable.map((u) => ({
                    id: u.container.id,
                    name: u.container.name,
                    reason: u.reason,
                })),
            });
            return;
        }

        const result = (await triggerToRun.trigger(containerToTrigger)) as
            | TriggerRunResult
            | undefined;
        log.info(
            `Trigger executed with success (type=${triggerType}, name=${triggerName}, container=${JSON.stringify(containerToTrigger)})`,
        );
        res.status(200).json(result ?? {});
    } catch (e) {
        if (e instanceof ContainerGoneError) {
            log.warn(
                `Container gone (type=${triggerType}, name=${triggerName}, container=${containerToTrigger.name})`,
            );
            res.status(409).json({
                error: e.message,
                containers: [containerToTrigger.id],
            });
            return;
        }
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
async function runRemoteTrigger(
    req: Request<{ agent: string; type: string; name: string }>,
    res: Response,
): Promise<void> {
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
        if (e instanceof RemoteTriggerError && e.status < 500) {
            res.status(e.status).json(e.body);
            return;
        }
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
export function init(): Router {
    const router = component.init('trigger');
    router.post('/:type/:name', runTrigger);
    router.post('/:agent/:type/:name', runRemoteTrigger);
    return router;
}
