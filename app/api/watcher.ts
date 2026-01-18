// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import * as registry from '../registry';
import { mapComponentsToList } from './component';
import { getAgents } from '../agent';

function getAllWatchers(req, res) {
    const localWatchers = registry.getState().watcher;
    const items = mapComponentsToList(localWatchers);
    
    const agents = getAgents();
    agents.forEach(agent => {
        if (agent.watchers) {
            Object.keys(agent.watchers).forEach(key => {
                const watcher = agent.watchers[key];
                // @ts-ignore
                items.push({
                    id: watcher.id,
                    type: watcher.type,
                    name: watcher.name,
                    configuration: watcher.configuration,
                    agent: agent.name
                });
            });
        }
    });
    
    res.json(items);
}

export function init() {
    const router = express.Router();
    router.use(nocache());
    router.get('/', getAllWatchers);
    return router;
}
