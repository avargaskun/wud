// @ts-nocheck
import { getTriggers, runTrigger, runTriggerBatch } from './trigger';
import * as registry from '../../registry';
import * as triggerApi from '../../api/trigger';

jest.mock('../../registry');
jest.mock('../../api/trigger', () => ({
    runTrigger: jest.fn(),
}));
jest.mock('../../log', () => {
    const mockLogger = {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
    };
    return {
        child: jest.fn().mockReturnValue(mockLogger),
        ...mockLogger,
    };
});

describe('Agent API Trigger', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('getTriggers should return list of triggers', () => {
        const triggers = {
            'docker.restart': {
                type: 'docker',
                name: 'restart',
                maskConfiguration: jest.fn().mockReturnValue({}),
            },
        };
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: triggers });

        const req = {};
        const res = { json: jest.fn() };

        getTriggers(req, res);

        expect(res.json).toHaveBeenCalledWith([
            expect.objectContaining({ name: 'restart', type: 'docker' }),
        ]);
    });

    test('runTrigger should sanitize body and delegate', async () => {
        const req = {
            params: { type: 'docker', name: 'restart' },
            body: { id: '123', agent: 'remote-agent' },
        };
        const res = {};

        await runTrigger(req, res);

        expect(req.body.agent).toBeUndefined();
        expect(triggerApi.runTrigger).toHaveBeenCalledWith(req, res);
    });

    test('runTriggerBatch should return 400 if body is not array', async () => {
        const req = {
            params: { type: 'docker', name: 'restart' },
            body: { id: '123' },
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await runTriggerBatch(req, res);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Body must be an array of containers',
        });
    });

    test('runTriggerBatch should return 404 if trigger not found', async () => {
        // @ts-ignore
        registry.getState.mockReturnValue({ trigger: {} });

        const req = {
            params: { type: 'docker', name: 'unknown' },
            body: [],
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await runTriggerBatch(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Trigger unknown not found',
        });
    });

    test('runTriggerBatch should execute trigger for each container', async () => {
        const mockTrigger = {
            triggerBatch: jest.fn().mockResolvedValue(true),
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: { 'docker.restart': mockTrigger },
        });

        const req = {
            params: { type: 'docker', name: 'restart' },
            body: [
                { id: '1', agent: 'remote' },
                { id: '2', agent: 'remote' },
            ],
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await runTriggerBatch(req, res);

        expect(mockTrigger.triggerBatch).toHaveBeenCalledWith([
            { id: '1' },
            { id: '2' },
        ]);
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({});
    });

    test('runTriggerBatch should return 500 if execution fails', async () => {
        const mockTrigger = {
            triggerBatch: jest.fn().mockRejectedValue(new Error('Failed')),
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            trigger: { 'docker.restart': mockTrigger },
        });

        const req = {
            params: { type: 'docker', name: 'restart' },
            body: [{ id: '1' }],
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await runTriggerBatch(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed' });
    });
});
