// @ts-nocheck
import express from 'express';
import * as agentClient from '../agent/client';

const router = express.Router();

router.get('/', (req, res) => {
    const clients = agentClient.getClients();
    const agents = clients.map(c => ({
        name: c.name,
        url: c.baseUrl,
        status: c.connected ? 'connected' : 'disconnected'
    }));
    res.json(agents);
});

export function init() {
    return router;
}
