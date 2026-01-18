// @ts-nocheck
import { init } from './AgentServer';
import * as storeContainer from '../store/container';
import * as registry from '../registry';

jest.mock('express');
jest.mock('fs');
jest.mock('https');
jest.mock('cors');
jest.mock('body-parser', () => ({ json: () => (req, res, next) => next() }));
jest.mock('../log');
jest.mock('../store/container');
jest.mock('../event');
jest.mock('../configuration');
jest.mock('../registry');

import express from 'express';
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
        process.env.WUD_AGENT_SECRET = 'test-secret';
    });

    test('should initialize agent server', async () => {
        await init();
        expect(express).toHaveBeenCalled();
        expect(mockApp.listen).toHaveBeenCalledWith(3000, expect.any(Function));
    });

    test('should setup routes', async () => {
        await init();
        expect(mockApp.get).toHaveBeenCalledWith('/api/containers', expect.any(Function));
        expect(mockApp.get).toHaveBeenCalledWith('/api/events', expect.any(Function));
        expect(mockApp.post).toHaveBeenCalledWith('/api/containers/:id/triggers/:triggerType/:triggerName', expect.any(Function));
    });
});
