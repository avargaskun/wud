// @ts-nocheck
import log, { logAxiosError } from './index';

// Mock the configuration module
jest.mock('../configuration', () => ({
    getLogLevel: jest.fn(() => 'info'),
}));

describe('Logger', () => {
    test('should export a bunyan logger instance', async () => {
        expect(log).toBeDefined();
        expect(typeof log.info).toBe('function');
        expect(typeof log.warn).toBe('function');
        expect(typeof log.error).toBe('function');
        expect(typeof log.debug).toBe('function');
    });

    test('should have correct logger name', async () => {
        expect(log.fields.name).toBe('whats-up-docker');
    });

    test('should have correct log level', async () => {
        expect(log.level()).toBe(30); // INFO level in bunyan
    });
});

describe('logAxiosError', () => {
    const buildLog = () => ({ warn: jest.fn(), debug: jest.fn() });

    const httpError = (status) => ({
        config: {
            method: 'get',
            url: 'https://ghcr.io/v2/user/repo/tags/list?n=1000',
            headers: { Accept: 'application/json' },
        },
        response: { status, data: { errors: [{ code: 'TOOMANYREQUESTS' }] } },
    });

    test('should log the three failure lines at warn', async () => {
        const mockLog = buildLog();
        logAxiosError(mockLog, httpError(429), 'warn');
        expect(mockLog.warn.mock.calls).toEqual([
            [
                'Request failed with status code [429] on [get https://ghcr.io/v2/user/repo/tags/list?n=1000]',
            ],
            ['Request headers [{"Accept":"application/json"}]'],
            ['Response body [{"errors":[{"code":"TOOMANYREQUESTS"}]}]'],
        ]);
        expect(mockLog.debug).not.toHaveBeenCalled();
    });

    test('should log the same three lines at debug', async () => {
        const mockLog = buildLog();
        logAxiosError(mockLog, httpError(503), 'debug');
        expect(mockLog.debug).toHaveBeenCalledTimes(3);
        expect(mockLog.debug.mock.calls[0][0]).toContain('[503]');
        expect(mockLog.warn).not.toHaveBeenCalled();
    });

    test('should stay silent for an error without a response', async () => {
        const mockLog = buildLog();
        logAxiosError(mockLog, new Error('socket hang up'), 'warn');
        logAxiosError(mockLog, undefined, 'warn');
        expect(mockLog.warn).not.toHaveBeenCalled();
    });

    test('should stay silent below status 400', async () => {
        const mockLog = buildLog();
        logAxiosError(mockLog, httpError(304), 'warn');
        expect(mockLog.warn).not.toHaveBeenCalled();
    });
});
