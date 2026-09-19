// @ts-nocheck
// Mock all dependencies
jest.mock('./configuration', () => ({
    getVersion: jest.fn(() => '1.0.0'),
}));

jest.mock('./log', () => ({
    info: jest.fn(),
    child: jest.fn().mockReturnThis(),
}));

jest.mock('./store', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./tagcache', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./registry', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./api', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./agent', () => ({
    init: jest.fn().mockResolvedValue(),
}));

jest.mock('./agent/api', () => ({
    init: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('./prometheus', () => ({
    init: jest.fn(),
}));

describe('Main Application', () => {
    beforeEach(async () => {
        jest.clearAllMocks();
        // Clear the module cache to ensure fresh imports
        jest.resetModules();
    });

    test('should initialize all components in correct order', async () => {
        const { default: log } = await import('./log');
        const store = await import('./store');
        const tagcache = await import('./tagcache');
        const registry = await import('./registry');
        const api = await import('./api');
        const agent = await import('./agent');
        const prometheus = await import('./prometheus');
        const { getVersion } = await import('./configuration');

        // Import and run the main module
        await import('./index');

        // Wait for async operations to complete
        await new Promise((resolve) => setImmediate(resolve));

        // Verify initialization order and calls
        expect(getVersion).toHaveBeenCalled();
        expect(log.info).toHaveBeenCalledWith(
            'WUD is starting in Controller mode (version = 1.0.0)',
        );
        expect(store.init).toHaveBeenCalled();
        expect(tagcache.init).toHaveBeenCalled();
        expect(prometheus.init).toHaveBeenCalled();
        expect(registry.init).toHaveBeenCalled();
        expect(agent.init).toHaveBeenCalled();
        expect(api.init).toHaveBeenCalled();
        expect(store.init.mock.invocationCallOrder[0]).toBeLessThan(
            tagcache.init.mock.invocationCallOrder[0],
        );
        expect(tagcache.init.mock.invocationCallOrder[0]).toBeLessThan(
            registry.init.mock.invocationCallOrder[0],
        );
    });

    test('should initialize all components in correct order in agent mode', async () => {
        const { default: log } = await import('./log');
        const store = await import('./store');
        const tagcache = await import('./tagcache');
        const registry = await import('./registry');
        const api = await import('./api');
        const agent = await import('./agent');
        const agentServer = await import('./agent/api');

        const originalArgv = process.argv;
        process.argv = [...originalArgv, '--agent'];
        try {
            await import('./index');

            await new Promise((resolve) => setImmediate(resolve));

            expect(log.info).toHaveBeenCalledWith(
                'WUD is starting in Agent mode (version = 1.0.0)',
            );
            expect(store.init).toHaveBeenCalledWith({ memory: true });
            expect(tagcache.init).toHaveBeenCalled();
            expect(registry.init).toHaveBeenCalledWith({ agent: true });
            expect(agentServer.init).toHaveBeenCalled();
            expect(api.init).not.toHaveBeenCalled();
            expect(agent.init).not.toHaveBeenCalled();
            expect(store.init.mock.invocationCallOrder[0]).toBeLessThan(
                tagcache.init.mock.invocationCallOrder[0],
            );
            expect(tagcache.init.mock.invocationCallOrder[0]).toBeLessThan(
                registry.init.mock.invocationCallOrder[0],
            );
        } finally {
            process.argv = originalArgv;
        }
    });
});
