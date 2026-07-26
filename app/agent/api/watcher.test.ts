// @ts-nocheck
import { getWatchers, watchWatcher, watchContainer } from './watcher';
import * as storeContainer from '../../store/container';
import * as registry from '../../registry';

jest.mock('../../store/container');
jest.mock('../../registry');
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

describe('Agent API Watcher', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('getWatchers should return list of watchers', () => {
        const watchers = {
            'docker.local': {
                type: 'docker',
                name: 'local',
                maskConfiguration: jest.fn().mockReturnValue({}),
            },
        };
        // @ts-ignore
        registry.getState.mockReturnValue({ watcher: watchers });

        const req = {};
        const res = { json: jest.fn() };

        getWatchers(req, res);

        expect(res.json).toHaveBeenCalledWith([
            expect.objectContaining({ name: 'local', type: 'docker' }),
        ]);
    });

    test('watchWatcher should find watcher and delegate', async () => {
        const mockWatcher = {
            type: 'docker',
            watch: jest.fn().mockResolvedValue(['c1']),
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: { 'docker.w1': mockWatcher },
        });

        const req = { params: { type: 'docker', name: 'w1' } };
        const res = { json: jest.fn() };

        await watchWatcher(req, res);

        expect(mockWatcher.watch).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(['c1']);
    });

    test('watchWatcher should return 404 if watcher not found', async () => {
        // @ts-ignore
        registry.getState.mockReturnValue({ watcher: {} });

        const req = { params: { type: 'docker', name: 'unknown' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchWatcher(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith({
            error: 'Watcher unknown not found',
        });
    });

    test('watchWatcher should return 500 if watch fails', async () => {
        const mockWatcher = {
            type: 'docker',
            watch: jest.fn().mockRejectedValue(new Error('Failed')),
        };
        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: { 'docker.w1': mockWatcher },
        });

        const req = { params: { type: 'docker', name: 'w1' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchWatcher(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed' });
    });

    test('watchContainer should find watcher/container and delegate', async () => {
        const mockWatcher = {
            type: 'docker',
            watchContainer: jest.fn().mockResolvedValue('result'),
        };
        const mockContainer = { id: 'c1' };

        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: { 'docker.w1': mockWatcher },
        });
        // @ts-ignore
        storeContainer.getContainer.mockReturnValue(mockContainer);

        const req = { params: { type: 'docker', name: 'w1', id: 'c1' } };
        const res = { json: jest.fn() };

        await watchContainer(req, res);

        expect(storeContainer.getContainer).toHaveBeenCalledWith('c1');
        expect(mockWatcher.watchContainer).toHaveBeenCalledWith(mockContainer);
        expect(res.json).toHaveBeenCalledWith('result');
    });

    test('watchContainer should return 404 if watcher not found', async () => {
        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: {},
        });

        const req = { params: { type: 'docker', name: 'unknown', id: 'c1' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchContainer(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('Watcher unknown not found'),
            }),
        );
    });

    test('watchContainer should return 404 if container not found', async () => {
        const mockWatcher = { type: 'docker' };
        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: { 'docker.w1': mockWatcher },
        });
        // @ts-ignore
        storeContainer.getContainer.mockReturnValue(undefined);

        const req = { params: { type: 'docker', name: 'w1', id: 'unknown' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchContainer(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('Container unknown not found'),
            }),
        );
    });

    test('watchContainer should return 500 if watch fails', async () => {
        const mockWatcher = {
            type: 'docker',
            watchContainer: jest.fn().mockRejectedValue(new Error('Failed')),
        };
        const mockContainer = { id: 'c1' };

        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: { 'docker.w1': mockWatcher },
        });
        // @ts-ignore
        storeContainer.getContainer.mockReturnValue(mockContainer);

        const req = { params: { type: 'docker', name: 'w1', id: 'c1' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchContainer(req, res);

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ error: 'Failed' });
    });
});
