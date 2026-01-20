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
}));
jest.mock('../log', () => ({
    child: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

describe('Trigger API', () => {
    let getAll;
    let getLocal;
    let runTrigger;
    let getRemote;
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
        getLocal = mockRouter.get.mock.calls[1][1];
        runTrigger = mockRouter.post.mock.calls[0][1];
        getRemote = mockRouter.get.mock.calls[2][1];
        runRemoteTrigger = mockRouter.post.mock.calls[1][1];

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
            sendStatus: jest.fn().mockReturnThis(),
        };
    });

    test('should return all triggers (local + remote)', () => {
        const localTriggers = {
            'docker.default': { type: 'docker', name: 'default' },
        };
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: localTriggers });
        // @ts-ignore
        component.mapComponentsToList.mockReturnValue([
            { type: 'docker', name: 'default' },
        ]);

        const mockAgent1 = {
            name: 'agent1',
            isConnected: true,
            triggers: [{ type: 'dockercompose', name: 'web' }],
        };
        const mockAgent2 = {
            name: 'agent2',
            isConnected: false,
            triggers: [{ type: 'docker', name: 'app' }],
        };
        // @ts-ignore
        agent.getAgents.mockReturnValue([mockAgent1, mockAgent2]);

        mockReq = {};
        getAll(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith([
            { type: 'docker', name: 'default' },
            { type: 'dockercompose', name: 'web', agent: 'agent1' },
        ]);
    });

    test('should return local trigger', () => {
        const mockTrigger = { type: 'docker', name: 'default' };
        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: { 'docker.default': mockTrigger },
        });
        // @ts-ignore
        component.mapComponentToItem.mockReturnValue(mockTrigger);

        mockReq = { params: { type: 'docker', name: 'default' } };
        getLocal(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(200);
        expect(mockRes.json).toHaveBeenCalledWith(mockTrigger);
    });

    test('should return 404 if local trigger not found', () => {
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: {} });

        mockReq = { params: { type: 'docker', name: 'unknown' } };
        getLocal(mockReq, mockRes);

        expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return remote trigger', () => {
        const mockAgent = {
            name: 'my-agent',
            triggers: [{ type: 'docker', name: 'default' }],
        };
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgent);

        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'default' },
        };
        getRemote(mockReq, mockRes);

        expect(mockRes.json).toHaveBeenCalledWith({
            type: 'docker',
            name: 'default',
            agent: 'my-agent',
        });
    });

    test('should return 404 if remote agent not found', () => {
        // @ts-ignore
        agent.getAgent.mockReturnValue(undefined);

        mockReq = {
            params: { agent: 'unknown', type: 'docker', name: 'default' },
        };
        getRemote(mockReq, mockRes);

        expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should return 404 if remote trigger not found on agent', () => {
        const mockAgent = {
            name: 'my-agent',
            triggers: [],
        };
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgent);

        mockReq = {
            params: { agent: 'my-agent', type: 'docker', name: 'unknown' },
        };
        getRemote(mockReq, mockRes);

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

    test('should proxy to agent if container has agent field AND trigger is local', async () => {
        const container = { id: '123', agent: 'my-agent' };
        mockReq = {
            params: { type: 'dockercompose', name: 'default' },
            body: container,
        };

        const mockAgentClient = {
            runRemoteTrigger: jest.fn().mockResolvedValue({}),
        };
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgentClient);

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    test('should run explicitly targeted remote trigger', async () => {
        const runRemoteTrigger = mockRouter.post.mock.calls[1][1]; // The second post call is /:agent/:type/:name

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
