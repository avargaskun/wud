// @ts-nocheck
import * as trigger from './trigger';
import * as agent from '../agent';
import * as registry from '../registry';
import * as component from './component';
import express from 'express';

jest.mock('express', () => ({
    Router: jest.fn(),
}));
jest.mock('nocache', () => jest.fn(() => (req, res, next) => next()));
jest.mock('../agent');
jest.mock('../registry');
jest.mock('./component', () => ({
    mapComponentsToList: jest.fn(),
    mapComponentToItem: jest.fn(),
    init: jest.fn((kind) => {
        const router = require('express').Router();
        const registry = require('../registry');
        const component = require('./component');

        router.get('/', (req, res) => {
            res.status(200).json(
                component.mapComponentsToList(registry.getState()[kind]),
            );
        });

        const getById = (req, res) => {
            const { agent, type, name } = req.params;
            const id = agent ? `${agent}.${type}.${name}` : `${type}.${name}`;
            const item = registry.getState()[kind][id];
            if (item) {
                res.status(200).json(component.mapComponentToItem(id, item));
            } else {
                res.sendStatus(404);
            }
        };

        router.get('/:type/:name', getById);
        router.get('/:agent/:type/:name', getById);
        return router;
    }),
}));
jest.mock('../log', () => ({
    child: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

describe('Trigger API', () => {
    let getAll;
    let getTrigger;
    let runTrigger;
    let runRemoteTrigger;
    let mockRes;
    let mockReq;
    let mockRouter;

    beforeEach(() => {
        jest.clearAllMocks();
        mockRouter = {
            post: jest.fn(),
            use: jest.fn(),
            get: jest.fn(),
        };
        // @ts-ignore
        express.Router.mockReturnValue(mockRouter);

        trigger.init();

        // Extract handlers
        getAll = mockRouter.get.mock.calls[0][1];
        getTrigger = mockRouter.get.mock.calls[1][1]; // Combined getter
        runTrigger = mockRouter.post.mock.calls[0][1];
        runRemoteTrigger = mockRouter.post.mock.calls[1][1];

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            sendStatus: jest.fn().mockReturnThis(),
        };
    });

    test('should return all triggers from registry', () => {
        const allTriggers = {
            'docker.default': { type: 'docker', name: 'default' },
            'agent.agent1-web': {
                type: 'agent',
                name: 'agent1-web',
                configuration: {
                    agent: 'agent1',
                    remoteType: 'dockercompose',
                    remoteName: 'web',
                },
            },
        };
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: allTriggers });
        const mappedTriggers = [
            { type: 'docker', name: 'default' },
            {
                type: 'dockercompose',
                name: 'web',
                agent: 'agent1',
            },
        ];
        // @ts-ignore
        component.mapComponentsToList.mockReturnValue(mappedTriggers);

        mockReq = {};
        getAll(mockReq, mockRes);

        expect(component.mapComponentsToList).toHaveBeenCalledWith(allTriggers);
        expect(mockRes.json).toHaveBeenCalledWith(mappedTriggers);
    });

    test('should return local trigger', () => {
        const mockTrigger = {
            type: 'docker',
            name: 'default',
            getId: () => 'docker.default',
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: { 'docker.default': mockTrigger },
        });
        // @ts-ignore
        component.mapComponentToItem.mockReturnValue(mockTrigger);

        mockReq = { params: { type: 'docker', name: 'default' } };
        getTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(mockTrigger);
    });

    test('should return 404 if local trigger not found', () => {
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: {} });

        mockReq = { params: { type: 'docker', name: 'unknown' } };
        getTrigger(mockReq, mockRes);

        expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return remote trigger from registry', () => {
        const mockAgentTrigger = {
            type: 'docker',
            name: 'default',
            agent: 'my-agent',
            getId: () => 'my-agent.docker.default',
        };
        const mappedTrigger = {
            type: 'docker',
            name: 'default',
            agent: 'my-agent',
        };

        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: { 'my-agent.docker.default': mockAgentTrigger },
        });
        // @ts-ignore
        component.mapComponentToItem.mockReturnValue(mappedTrigger);

        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'default' },
        };
        getTrigger(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith(mappedTrigger);
    });

    test('should return 404 if remote trigger not found in registry', () => {
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: {} });

        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'unknown' },
        };
        getTrigger(mockReq, mockRes);

        expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 400 if container is missing', async () => {
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: null,
        };

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('container is undefined'),
            }),
        );
    });

    test('should return 400 for local trigger on remote container', async () => {
        const container = { id: '123', agent: 'my-agent' };
        mockReq = {
            params: { type: 'dockercompose', name: 'default' },
            body: container,
        };

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    test('should run explicitly targeted remote trigger', async () => {
        const container = { id: '123' };
        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'default' },
            body: container,
        };

        const mockAgentClient = {
            runRemoteTrigger: jest.fn().mockResolvedValue({}),
        };
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgentClient);

        await runRemoteTrigger(mockReq, mockRes);

        expect(agent.getAgent).toHaveBeenCalledWith('my-agent');
        expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith(
            container,
            'docker',
            'default',
        );
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test('should run local trigger if no agent field', async () => {
        const container = { id: '123' };
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: container,
        };

        const mockTrigger = {
            trigger: jest.fn().mockResolvedValue({}),
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: {
                'docker.default': mockTrigger,
            },
        });

        await runTrigger(mockReq, mockRes);

        expect(mockTrigger.trigger).toHaveBeenCalledWith(container);
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test('should return 404 if local trigger is not found', async () => {
        const container = { id: '123' };
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: container,
        };

        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: {},
        });

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('trigger not found'),
            }),
        );
    });

    test('should return 500 if local trigger fails', async () => {
        const container = { id: '123' };
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: container,
        };

        const mockTrigger = {
            trigger: jest.fn().mockRejectedValue(new Error('Trigger error')),
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: {
                'docker.default': mockTrigger,
            },
        });

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('Trigger error'),
            }),
        );
    });

    test('should return 404 if remote agent not found for runRemoteTrigger', async () => {
        // @ts-ignore
        agent.getAgent.mockReturnValue(undefined);

        mockReq = {
            params: { agent: 'unknown', type: 'docker', name: 'default' },
            body: { id: '123' },
        };

        await runRemoteTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: 'Agent unknown not found',
        });
    });

    test('should return 400 if container or id missing for runRemoteTrigger', async () => {
        const mockAgentClient = {};
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgentClient);

        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'default' },
            body: {},
        };

        await runRemoteTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith({
            error: 'Container with ID is required in body',
        });
    });

    test('should return 500 if runRemoteTrigger fails', async () => {
        const container = { id: '123' };
        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'default' },
            body: container,
        };

        const mockAgentClient = {
            runRemoteTrigger: jest
                .fn()
                .mockRejectedValue(new Error('Remote error')),
        };
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgentClient);

        await runRemoteTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(500);
        expect(mockRes.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('Remote error'),
            }),
        );
    });
});
