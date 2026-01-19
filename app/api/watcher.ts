import express from 'express';
import nocache from 'nocache';
import * as registry from '../registry';
import { mapComponentsToList, mapComponentToItem } from './component';
import { getAgents, getAgent } from '../agent';

function getAllWatchers(req, res) {
    const localWatchers = registry.getState().watcher;
    const items = mapComponentsToList(localWatchers);

    const agents = getAgents();
    agents.forEach((agent) => {
        if (agent.watchers) {
            agent.watchers.forEach((watcher) => {
                items.push({
                    id: watcher.id,
                    type: watcher.type,
                    name: watcher.name,
                    configuration: watcher.configuration,
                    agent: agent.name,
                });
            });
        }
    });

    res.json(items);
}

function getLocalWatcher(req, res) {
    const { type, name } = req.params;
    const id = `${type}.${name}`;
    const component = registry.getState().watcher[id];
    if (component) {
        res.status(200).json(mapComponentToItem(id, component));
    } else {
        res.sendStatus(404);
    }
}

function getAgentWatcher(req, res) {
    const { agent: agentName, type, name } = req.params;
    const agent = getAgent(agentName);
    if (!agent) {
        res.sendStatus(404);
        return;
    }
    const watcher = agent.watchers.find(
        (w) => w.type === type && w.name === name,
    );
    if (watcher) {
        res.status(200).json({
            id: watcher.id,
            type: watcher.type,
            name: watcher.name,
            configuration: watcher.configuration,
            agent: agent.name,
        });
    } else {
        res.sendStatus(404);
    }
}

export function init() {
    const router = express.Router();
    router.use(nocache());
    router.get('/', getAllWatchers);
    router.get('/:type/:name', getLocalWatcher);
    router.get('/:agent/:type/:name', getAgentWatcher);
    return router;
}
