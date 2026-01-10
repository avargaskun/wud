// @ts-nocheck
import express from 'express';
import passport from 'passport';
import appRouter from './app';
import containerRouter from './container';
import watcherRouter from './watcher';
import triggerRouter from './trigger';
import registryRouter from './registry';
import authenticationRouter from './authentication';
import logRouter from './log';
import storeRouter from './store';
import serverRouter from './server';
import auth from './auth';

/**
 * Init the API router.
 * @returns {*|Router}
 */
function init() {
    const router = express.Router();

    // Mount app router
    router.use('/app', appRouter.init());

    // Routes to protect after this line
    router.use(passport.authenticate(auth.getAllIds()));

    // Mount log router
    router.use('/log', logRouter.init());

    // Mount store router
    router.use('/store', storeRouter.init());

    // Mount server router
    router.use('/server', serverRouter.init());

    // Mount container router
    router.use('/containers', containerRouter.init());

    // Mount trigger router
    router.use('/triggers', triggerRouter.init());

    // Mount watcher router
    router.use('/watchers', watcherRouter.init());

    // Mount registry router
    router.use('/registries', registryRouter.init());

    // Mount auth
    router.use('/authentications', authenticationRouter.init());

    // All other API routes => 404
    router.get('/*', (req, res) => res.sendStatus(404));

    return router;
}

export default {
    init,
};
