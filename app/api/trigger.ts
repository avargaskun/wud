// @ts-nocheck
import * as component from './component';
import * as registry from '../registry';
import * as agent from '../agent';
import logger from '../log';
const log = logger.child({ component: 'trigger' });

/**
 * Run a specific trigger on a specific container provided in the payload.
 * @param {*} req
 * @param {*} res
 * @returns
 */
async function runTrigger(req, res) {
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

    // Proxy to agent if container is remote
    if (containerToTrigger.agent) {
        const agentClient = agent.getAgent(containerToTrigger.agent);
        if (!agentClient) {
            log.warn(`Agent ${containerToTrigger.agent} not found for container ${containerToTrigger.id}`);
            res.status(404).json({
                error: `Error when running trigger ${triggerType}.${triggerName} (agent ${containerToTrigger.agent} not found)`,
            });
            return;
        }
        try {
            await agentClient.runRemoteTrigger(containerToTrigger.id, triggerType, triggerName);
            log.info(
                `Remote trigger executed with success (agent=${containerToTrigger.agent}, type=${triggerType}, name=${triggerName}, container=${containerToTrigger.id})`,
            );
            res.status(200).json({});
        } catch (e) {
            log.warn(
                `Error when running remote trigger ${triggerType}.${triggerName} on agent ${containerToTrigger.agent} (${e.message})`,
            );
            res.status(500).json({
                error: `Error when running remote trigger ${triggerType}.${triggerName} on agent ${containerToTrigger.agent} (${e.message})`,
            });
        }
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
 * Init Router.
 * @returns {*}
 */
export function init() {
    const router = component.init('trigger');
    router.post('/:type/:name', (req, res) => runTrigger(req, res));
    return router;
}
