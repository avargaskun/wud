jest.mock('./log', () => ({
    __esModule: true,
    default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('./registry', () => ({
    deregisterAll: jest.fn(),
}));

jest.mock('./store', () => ({
    close: jest.fn(),
}));

type ShutdownModule = typeof import('./shutdown');
type RegistryModule = { deregisterAll: jest.Mock };
type StoreModule = { close: jest.Mock };

let shutdownModule: ShutdownModule;
let registry: RegistryModule;
let store: StoreModule;
let exitSpy: jest.SpyInstance;

beforeEach(() => {
    jest.resetModules();
    jest.isolateModules(() => {
        shutdownModule = require('./shutdown');
        registry = require('./registry');
        store = require('./store');
    });
    registry.deregisterAll.mockResolvedValue(undefined);
    store.close.mockResolvedValue(undefined);
    exitSpy = jest
        .spyOn(process, 'exit')
        .mockImplementation((() => undefined) as () => never);
});

afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    exitSpy.mockRestore();
});

test('shutdown should deregister components, close the store and exit 0', async () => {
    await shutdownModule.shutdown('SIGTERM');

    expect(registry.deregisterAll).toHaveBeenCalledTimes(1);
    expect(store.close).toHaveBeenCalledTimes(1);
    expect(registry.deregisterAll.mock.invocationCallOrder[0]).toBeLessThan(
        store.close.mock.invocationCallOrder[0],
    );
    expect(exitSpy).toHaveBeenCalledWith(0);
});

test('shutdown should still close the store and exit 1 when deregistration fails', async () => {
    registry.deregisterAll.mockRejectedValue(new Error('boom'));

    await shutdownModule.shutdown('SIGTERM');

    expect(store.close).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
});

test('shutdown should exit 1 when closing the store fails', async () => {
    store.close.mockRejectedValue(new Error('disk full'));

    await shutdownModule.shutdown('SIGINT');

    expect(exitSpy).toHaveBeenCalledWith(1);
});

test('a second signal during shutdown should exit 1 immediately', async () => {
    jest.useFakeTimers();
    registry.deregisterAll.mockReturnValue(new Promise(() => {}));

    void shutdownModule.shutdown('SIGTERM');
    await shutdownModule.shutdown('SIGINT');

    expect(registry.deregisterAll).toHaveBeenCalledTimes(1);
    expect(exitSpy).toHaveBeenCalledWith(1);
});

test('shutdown should force exit 1 when it does not complete in time', async () => {
    jest.useFakeTimers();
    registry.deregisterAll.mockReturnValue(new Promise(() => {}));

    void shutdownModule.shutdown('SIGTERM');
    jest.advanceTimersByTime(4999);
    expect(exitSpy).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);

    expect(exitSpy).toHaveBeenCalledWith(1);
});

test('registerShutdownHandlers should shut down on SIGINT and SIGTERM', () => {
    const onSpy = jest.spyOn(process, 'on').mockReturnValue(process);

    shutdownModule.registerShutdownHandlers();

    expect(onSpy).toHaveBeenCalledWith('SIGINT', shutdownModule.shutdown);
    expect(onSpy).toHaveBeenCalledWith('SIGTERM', shutdownModule.shutdown);
    onSpy.mockRestore();
});
