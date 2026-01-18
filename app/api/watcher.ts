// @ts-nocheck
import express from 'express';
import nocache from 'nocache';
import * as component from './component';
import * as registry from '../registry';
import * as agentClient from '../agent/client';

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
    const router = express.Router();
    router.use(nocache());
    router.get('/', (req, res) => {
        const localWatchers = component.mapComponentsToList(registry.getState().watcher);
        const remoteWatchers = agentClient.getRemoteWatchers();
        res.status(200).json([...localWatchers, ...remoteWatchers]);
    });
    router.get('/:type/:name', (req, res) => component.getById(req, res, 'watcher'));
    return router;
}
