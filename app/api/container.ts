import express from 'express';
import nocache from 'nocache';
import {
    getContainers,
    getContainer,
    deleteContainer,
    watchContainers,
    getContainerTriggers,
    runTrigger,
    runTriggerBatch,
    watchContainer,
} from './container.handlers';

const router = express.Router();

/**
 * Init Router.
 * @returns {*}
 */
export function init() {
    router.use(nocache());
    router.get('/', getContainers);
    router.post('/watch', watchContainers);
    router.post('/batch/triggers/:triggerType/:triggerName', runTriggerBatch);
    router.post(
        '/batch/triggers/:triggerAgent/:triggerType/:triggerName',
        runTriggerBatch,
    );
    router.get('/:id', getContainer);
    router.delete('/:id', deleteContainer);
    router.get('/:id/triggers', getContainerTriggers);
    router.post('/:id/triggers/:triggerType/:triggerName', runTrigger);
    router.post(
        '/:id/triggers/:triggerAgent/:triggerType/:triggerName',
        runTrigger,
    );
    router.post('/:id/watch', watchContainer);
    return router;
}
