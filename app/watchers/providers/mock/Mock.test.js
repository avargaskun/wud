const Mock = require('./Mock');
const storeContainer = require('../../../store/container');
const event = require('../../../event');

jest.mock('../../../store/container');
jest.mock('../../../event');

describe('Mock Watcher', () => {
    let mock;

    beforeEach(() => {
        jest.clearAllMocks();
        storeContainer.getContainer.mockReturnValue(undefined);
        storeContainer.insertContainer.mockImplementation(c => c);

        mock = new Mock();
    });

    test('should create instance', () => {
        expect(mock).toBeDefined();
        expect(mock).toBeInstanceOf(Mock);
    });

    test('should return configuration schema', () => {
        const schema = mock.getConfigurationSchema();
        expect(schema).toBeDefined();
    });

    test('should init without error', () => {
        expect(() => mock.init()).not.toThrow();
    });

    test('should watch and report container', async () => {
        const results = await mock.watch();

        expect(results).toHaveLength(1);
        expect(results[0].container.id).toBe('mock-container');
        expect(results[0].changed).toBe(true);

        expect(storeContainer.insertContainer).toHaveBeenCalled();
        expect(event.emitContainerReport).toHaveBeenCalled();
    });
});
