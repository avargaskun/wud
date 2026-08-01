import { Request, Response } from 'express';
import { byValues, byString } from 'sort-es';
import * as storeContainer from '../store/container';
import * as registry from '../registry';
import { getServerConfiguration } from '../configuration';
import logger from '../log';
import { getAgent } from '../agent/manager';
import {
    Container,
    UpdateBucketKey,
    UPDATE_BUCKET_KEYS,
} from '../model/container';
import Trigger from '../triggers/providers/Trigger';
import { BatchTriggerRequestBody, TriggerRequestBody } from './types';

const log = logger.child({ component: 'container' });

function parseBucket(body: unknown): {
    bucket?: UpdateBucketKey;
    error?: string;
} {
    const { bucket } = (body || {}) as Partial<TriggerRequestBody>;
    if (bucket === undefined) return {};
    if (!(UPDATE_BUCKET_KEYS as readonly string[]).includes(bucket)) {
        return {
            error: `bucket must be one of ${UPDATE_BUCKET_KEYS.join(', ')}`,
        };
    }
    return { bucket };
}

/**
 * Return registered watchers.
 * @returns {{id: string}[]}
 */
function getWatchers() {
    return registry.getState().watcher;
}

/**
 * Return registered triggers.
 * @returns {{id: string}[]}
 */
function getTriggers() {
    return registry.getState().trigger;
}

/**
 * Get containers from store.
 * @param query
 * @returns {*}
 */
export function getContainersFromStore(query) {
    return storeContainer.getContainers(query);
}

/**
 * Get all (filtered) containers.
 * @param req
 * @param res
 */
export function getContainers(req, res) {
    const { query } = req;
    res.status(200).json(getContainersFromStore(query));
}

/**
 * Get a container by id.
 * @param req
 * @param res
 */
export function getContainer(req, res) {
    const { id } = req.params;
    const container = storeContainer.getContainer(id);
    if (container) {
        res.status(200).json(container);
    } else {
        res.sendStatus(404);
    }
}

/**
 * Delete a container by id.
 * @param req
 * @param res
 */
export async function deleteContainer(req, res) {
    const serverConfiguration = getServerConfiguration();
    if (!serverConfiguration.feature.delete) {
        res.sendStatus(403);
    } else {
        const { id } = req.params;
        const container = storeContainer.getContainer(id);
        if (container) {
            if (container.agent) {
                const agent = getAgent(container.agent);
                if (agent) {
                    try {
                        await agent.deleteContainer(id);
                        storeContainer.deleteContainer(id);
                        res.sendStatus(204);
                    } catch (e) {
                        if (e.response && e.response.status === 404) {
                            storeContainer.deleteContainer(id);
                            res.sendStatus(204);
                        } else {
                            res.status(500).json({
                                error: `Error deleting container on agent (${e.message})`,
                            });
                        }
                    }
                } else {
                    res.status(500).json({
                        error: `Agent ${container.agent} not found`,
                    });
                }
            } else {
                storeContainer.deleteContainer(id);
                res.sendStatus(204);
            }
        } else {
            res.sendStatus(404);
        }
    }
}

/**
 * Watch all containers.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
export async function watchContainers(req, res) {
    try {
        await Promise.all(
            Object.values(getWatchers()).map((watcher) => watcher.watch()),
        );
        getContainers(req, res);
    } catch (e) {
        res.status(500).json({
            error: `Error when watching images (${e.message})`,
        });
    }
}

export async function getContainerTriggers(req, res) {
    const { id } = req.params;

    const container = storeContainer.getContainer(id);
    if (container) {
        const triggers = getTriggers();
        const associatedTriggers = [];
        Object.values(triggers).forEach((trigger) => {
            const effectiveConfiguration = trigger.apply(container);
            if (effectiveConfiguration) {
                associatedTriggers.push({
                    id: trigger.getId(),
                    type: trigger.type,
                    name: trigger.name,
                    agent: trigger.agent,
                    auto: trigger.isAutoForContainer(container),
                    configuration: trigger.maskConfiguration(
                        effectiveConfiguration,
                    ),
                });
            }
        });
        associatedTriggers.sort(
            byValues([
                [(x) => x.type, byString()],
                [(x) => x.name, byString()],
            ]),
        );
        res.status(200).json(associatedTriggers);
    } else {
        res.sendStatus(404);
    }
}

/**
 * Run trigger.
 * @param {*} req
 * @param {*} res
 */
export async function runTrigger(req: Request, res: Response): Promise<void> {
    const { id, triggerAgent, triggerType, triggerName } = req.params;

    const { bucket, error: bucketError } = parseBucket(req.body);
    if (bucketError) {
        res.status(400).json({ error: bucketError });
        return;
    }

    const containerToTrigger = storeContainer.getContainer(id);
    if (!containerToTrigger) {
        res.status(404).json({
            error: 'Container not found',
        });
        return;
    }

    const triggerId = triggerAgent
        ? `${triggerAgent}.${triggerType}.${triggerName}`
        : `${triggerType}.${triggerName}`;
    const triggerToRun = getTriggers()[triggerId];
    if (!triggerToRun) {
        res.status(404).json({
            error: 'Trigger not found',
        });
        return;
    }

    try {
        if (bucket) {
            const update = containerToTrigger.updates?.[bucket];
            if (!update) {
                res.status(400).json({
                    error: `Container has no populated '${bucket}' update`,
                });
                return;
            }
            await triggerToRun.trigger(
                Trigger.buildTriggerView(containerToTrigger, update),
            );
        } else {
            await triggerToRun.trigger(containerToTrigger);
        }
        log.info(
            `Trigger executed with success (type=${triggerType}, name=${triggerName}, container=${JSON.stringify(containerToTrigger)})`,
        );
        res.status(200).json({});
    } catch (e) {
        log.warn(
            `Error when running trigger (type=${triggerType}, name=${triggerName}) (${e.message})`,
        );
        res.status(500).json({
            error: `Error when running trigger (type=${triggerType}, name=${triggerName}) (${e.message})`,
        });
    }
}

/**
 * Run a trigger against multiple containers as a single lockstep batch.
 * @param req
 * @param res
 */
export async function runTriggerBatch(
    req: Request,
    res: Response,
): Promise<void> {
    const { triggerAgent, triggerType, triggerName } = req.params;
    const { containerIds }: Partial<BatchTriggerRequestBody> = req.body || {};

    // 1. Body shape
    if (!Array.isArray(containerIds) || containerIds.length === 0) {
        res.status(400).json({
            error: 'containerIds must be a non-empty array',
        });
        return;
    }

    // 1b. Reject duplicate ids (a duplicate would otherwise swap the same container twice)
    const duplicates = [
        ...new Set(
            containerIds.filter(
                (id, index) => containerIds.indexOf(id) !== index,
            ),
        ),
    ];
    if (duplicates.length > 0) {
        res.status(400).json({
            error: 'containerIds must not contain duplicates',
            duplicates,
        });
        return;
    }

    // 2. Trigger exists
    const triggerId = triggerAgent
        ? `${triggerAgent}.${triggerType}.${triggerName}`
        : `${triggerType}.${triggerName}`;
    const triggerToRun = getTriggers()[triggerId];
    if (!triggerToRun) {
        res.status(404).json({ error: 'Trigger not found' });
        return;
    }

    // 3. Resolve every container from the store — all-or-nothing
    const containers: Container[] = [];
    const missing: string[] = [];
    containerIds.forEach((id) => {
        const container = storeContainer.getContainer(id);
        if (container) {
            containers.push(container);
        } else {
            missing.push(id);
        }
    });
    if (missing.length > 0) {
        res.status(404).json({ error: 'Container(s) not found', missing });
        return;
    }

    // 4. Homogeneity: one trigger, one host. Reject mixed agent/watcher.
    const expectedAgent = triggerAgent || undefined;
    const badAgent = containers.filter(
        (container) => (container.agent || undefined) !== expectedAgent,
    );
    if (badAgent.length > 0) {
        res.status(400).json({
            error: 'All containers must belong to the trigger agent',
            containers: badAgent.map((container) => container.id),
        });
        return;
    }
    const watchers = new Set(containers.map((container) => container.watcher));
    if (watchers.size > 1) {
        res.status(400).json({
            error: 'All containers must share the same watcher',
        });
        return;
    }

    // 5. Fail fast: a batch update only makes sense for containers with a pending update
    const noUpdate = containers.filter(
        (container) => !container.updateAvailable || !container.updateKind,
    );
    if (noUpdate.length > 0) {
        res.status(400).json({
            error: 'All containers must have a pending update',
            containers: noUpdate.map((container) => container.id),
        });
        return;
    }

    // 6. Reject containers this trigger cannot handle as a batch (e.g. a
    //    docker-compose container that does not belong to a managed compose file),
    //    then run — all in one try so grouping errors surface as 500, not a hang.
    try {
        const unbatchable =
            await triggerToRun.getUnbatchableContainers(containers);
        if (unbatchable.length > 0) {
            res.status(400).json({
                error: 'All containers must be updatable by this trigger as a batch',
                containers: unbatchable.map((container) => container.id),
            });
            return;
        }

        await triggerToRun.triggerBatch(containers);
        log.info(
            `Batch trigger executed with success (trigger=${triggerId}, containers=${containers.length})`,
        );
        res.status(200).json({});
    } catch (e) {
        log.warn(
            `Error when running batch trigger (trigger=${triggerId}) (${e.message})`,
        );
        res.status(500).json({
            error: `Error when running batch trigger (${e.message})`,
        });
    }
}

/**
 * Watch an image.
 * @param req
 * @param res
 * @returns {Promise<void>}
 */
export async function watchContainer(req, res) {
    const { id } = req.params;

    const container = storeContainer.getContainer(id);
    if (container) {
        let watcherId = `docker.${container.watcher}`;
        if (container.agent) {
            watcherId = `${container.agent}.${watcherId}`;
        }
        const watcher = getWatchers()[watcherId];
        if (!watcher) {
            res.status(500).json({
                error: `No provider found for container ${id} and provider ${watcherId}`,
            });
        } else {
            try {
                // Ensure container is still in store
                // (for cases where it has been removed before running an new watchAll)
                const containers = await watcher.getContainers();
                const containerFound = containers.find(
                    (containerInList) => containerInList.id === container.id,
                );

                if (!containerFound) {
                    res.status(404).send();
                } else {
                    // Run watchContainer from the Provider
                    const containerReport =
                        await watcher.watchContainer(container);
                    res.status(200).json(containerReport.container);
                }
            } catch (e) {
                res.status(500).json({
                    error: `Error when watching container ${id} (${e.message})`,
                });
            }
        }
    } else {
        res.sendStatus(404);
    }
}
