// @ts-nocheck
import { init } from './index';
import * as storeContainer from '../../store/container';
import * as registry from '../../registry';
import * as triggerApi from '../../api/trigger';

jest.mock('express');
jest.mock('fs');
jest.mock('https');
jest.mock('cors');
jest.mock('body-parser', () => ({ json: () => (req, res, next) => next() }));
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
jest.mock('../../store/container');
jest.mock('../../event');
jest.mock('../../configuration');
jest.mock('../../registry');
jest.mock('../../api/trigger', () => ({
    runTrigger: jest.fn(),
}));

import express from 'express';
import fs from 'fs';
import { getServerConfiguration } from '../../configuration';

describe('Agent Server', () => {
    let mockApp;

    beforeEach(() => {
        jest.clearAllMocks();
        mockApp = {
            use: jest.fn(),
            get: jest.fn(),
            post: jest.fn(),
            delete: jest.fn(),
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
});
