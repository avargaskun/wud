// @ts-nocheck
import * as trigger from './trigger';
import * as agent from '../agent';
import * as registry from '../registry';

jest.mock('../agent');
jest.mock('../registry');
jest.mock('./component', () => ({
    init: jest.fn(() => ({
        post: jest.fn(),
    })),
}));
jest.mock('../log', () => ({
    child: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
    })),
}));

describe('Trigger API', () => {
    let runTrigger;
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
        const component = require('./component');
        component.init.mockReturnValue(mockRouter);
        
        trigger.init();
        
        // Extract runTrigger from router.post call
        runTrigger = mockRouter.post.mock.calls[0][1];

        mockRes = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn().mockReturnThis(),
        };
    });

    test('should return 400 if container is missing', async () => {
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: null,
        };

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(400);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('container is undefined'),
        }));
    });

    test('should proxy to agent if container has agent field', async () => {
        const container = { id: '123', agent: 'my-agent' };
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: container,
        };

        const mockAgentClient = {
            runRemoteTrigger: jest.fn().mockResolvedValue({}),
        };
        // @ts-ignore
        agent.getAgent.mockReturnValue(mockAgentClient);

        await runTrigger(mockReq, mockRes);

        expect(agent.getAgent).toHaveBeenCalledWith('my-agent');
        expect(mockAgentClient.runRemoteTrigger).toHaveBeenCalledWith('123', 'docker', 'default');
        expect(mockRes.status).toHaveBeenCalledWith(200);
    });

    test('should return 404 if agent is not found', async () => {
        const container = { id: '123', agent: 'unknown-agent' };
        mockReq = {
            params: { type: 'docker', name: 'default' },
            body: container,
        };

        // @ts-ignore
        agent.getAgent.mockReturnValue(null);

        await runTrigger(mockReq, mockRes);

        expect(mockRes.status).toHaveBeenCalledWith(404);
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('agent unknown-agent not found'),
        }));
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
        expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
            error: expect.stringContaining('trigger not found'),
        }));
    });
});
