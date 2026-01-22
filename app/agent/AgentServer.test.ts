// @ts-nocheck
import { init } from './AgentServer';
import * as storeContainer from '../store/container';
import * as registry from '../registry';
import * as triggerApi from '../api/trigger';

jest.mock('express');
jest.mock('fs');
jest.mock('https');
jest.mock('cors');
jest.mock('body-parser', () => ({ json: () => (req, res, next) => next() }));
jest.mock('../log', () => {
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
jest.mock('../store/container');
jest.mock('../event');
jest.mock('../configuration');
jest.mock('../registry');
jest.mock('../api/trigger', () => ({
    runTrigger: jest.fn(),
}));

import express from 'express';
import fs from 'fs';
import { getServerConfiguration } from '../configuration';

describe('Agent Server', () => {
    let mockApp;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApp = {
            use: jest.fn(),
            get: jest.fn(),
            post: jest.fn(),
            listen: jest.fn(),
        };
        express.mockReturnValue(mockApp);
        getServerConfiguration.mockReturnValue({
            port: 3000,
            tls: { enabled: false },
            cors: { enabled: false },
        });
        delete process.env.WUD_AGENT_SECRET;
        delete process.env.WUD_AGENT_SECRET_FILE;
    });

    test('should throw error if no secret is provided', async () => {
        await expect(init()).rejects.toThrow(
            'WUD Agent mode requires WUD_AGENT_SECRET or WUD_AGENT_SECRET_FILE',
        );
    });

    test('should initialize agent server with WUD_AGENT_SECRET', async () => {
        process.env.WUD_AGENT_SECRET = 'test-secret';
        await init();
        expect(express).toHaveBeenCalled();
        expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    test('should initialize agent server with WUD_AGENT_SECRET_FILE', async () => {
        process.env.WUD_AGENT_SECRET_FILE = '/tmp/secret';
        fs.readFileSync.mockReturnValue('file-secret');
        await init();
        expect(fs.readFileSync).toHaveBeenCalledWith('/tmp/secret', 'utf-8');
        expect(express).toHaveBeenCalled();
        expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    test('should throw error if WUD_AGENT_SECRET_FILE cannot be read', async () => {
        process.env.WUD_AGENT_SECRET_FILE = '/tmp/secret';
        fs.readFileSync.mockImplementation(() => {
            throw new Error('File not found');
        });
        await expect(init()).rejects.toThrow('Error reading secret file');
    });

    test('should setup routes', async () => {
        process.env.WUD_AGENT_SECRET = 'test-secret';
        await init();
        expect(mockApp.get).toHaveBeenCalledWith(
            '/api/containers',
            expect.any(Function),
        );
        expect(mockApp.get).toHaveBeenCalledWith(
            '/api/events',
            expect.any(Function),
        );
        expect(mockApp.post).toHaveBeenCalledWith(
            '/api/triggers/:type/:name',
            expect.any(Function),
        );
        expect(mockApp.post).toHaveBeenCalledWith(
            '/api/watchers/:type/:name',
            expect.any(Function),
        );
        expect(mockApp.post).toHaveBeenCalledWith(
            '/api/watchers/:type/:name/container/:id',
            expect.any(Function),
        );
    });

    test('authenticate middleware should accept valid secret', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        // Extract the middleware function
        const authMiddleware = mockApp.use.mock.calls.find(
            (call) => call[0].name === 'authenticate',
        )[0];

        const req = {
            headers: { 'x-wud-agent-secret': 'valid-secret' },
            ip: '127.0.0.1',
        };
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
        const next = jest.fn();

        authMiddleware(req, res, next);
        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });

    test('authenticate middleware should reject invalid secret', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const authMiddleware = mockApp.use.mock.calls.find(
            (call) => call[0].name === 'authenticate',
        )[0];

        const req = {
            headers: { 'x-wud-agent-secret': 'invalid-secret' },
            ip: '127.0.0.1',
        };
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
        const next = jest.fn();

        authMiddleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('authenticate middleware should reject if no secret header', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const authMiddleware = mockApp.use.mock.calls.find(
            (call) => call[0].name === 'authenticate',
        )[0];

        const req = {
            headers: {},
            ip: '127.0.0.1',
        };
        const res = { status: jest.fn().mockReturnThis(), send: jest.fn() };
        const next = jest.fn();

        authMiddleware(req, res, next);
        expect(next).not.toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(401);
    });

    test('runTrigger should sanitize body and delegate', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const runTriggerHandler = mockApp.post.mock.calls.find(
            (call) => call[0] === '/api/triggers/:type/:name',
        )[1];

        const req = {
            params: { type: 'docker', name: 'restart' },
            body: { id: '123', agent: 'remote-agent' },
        };
        const res = {};

        await runTriggerHandler(req, res);

        expect(req.body.agent).toBeUndefined();
        expect(triggerApi.runTrigger).toHaveBeenCalledWith(req, res);
    });

    test('watchWatcher should find watcher and delegate', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const watchWatcherHandler = mockApp.post.mock.calls.find(
            (call) => call[0] === '/api/watchers/:type/:name',
        )[1];

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

        await watchWatcherHandler(req, res);

        expect(mockWatcher.watch).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(['c1']);
    });

    test('watchWatcher should return 404 if watcher not found', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const watchWatcherHandler = mockApp.post.mock.calls.find(
            (call) => call[0] === '/api/watchers/:type/:name',
        )[1];

        // @ts-ignore
        registry.getState.mockReturnValue({ watcher: {} });

        const req = { params: { type: 'docker', name: 'unknown' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchWatcherHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
    });

    test('watchContainer should find watcher/container and delegate', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const watchContainerHandler = mockApp.post.mock.calls.find(
            (call) => call[0] === '/api/watchers/:type/:name/container/:id',
        )[1];

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

        await watchContainerHandler(req, res);

        expect(storeContainer.getContainer).toHaveBeenCalledWith('c1');
        expect(mockWatcher.watchContainer).toHaveBeenCalledWith(mockContainer);
        expect(res.json).toHaveBeenCalledWith('result');
    });

    test('watchContainer should return 404 if watcher not found', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const watchContainerHandler = mockApp.post.mock.calls.find(
            (call) => call[0] === '/api/watchers/:type/:name/container/:id',
        )[1];

        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: {},
        });

        const req = { params: { type: 'docker', name: 'unknown', id: 'c1' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchContainerHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('Watcher unknown not found'),
            }),
        );
    });

    test('watchContainer should return 404 if container not found', async () => {
        process.env.WUD_AGENT_SECRET = 'valid-secret';
        await init();

        const watchContainerHandler = mockApp.post.mock.calls.find(
            (call) => call[0] === '/api/watchers/:type/:name/container/:id',
        )[1];

        const mockWatcher = { type: 'docker' };
        // @ts-ignore
        registry.getState.mockReturnValue({
            watcher: { 'docker.w1': mockWatcher },
        });
        // @ts-ignore
        storeContainer.getContainer.mockReturnValue(undefined);

        const req = { params: { type: 'docker', name: 'w1', id: 'unknown' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        await watchContainerHandler(req, res);

        expect(res.status).toHaveBeenCalledWith(404);
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: expect.stringContaining('Container unknown not found'),
            }),
        );
    });
});
