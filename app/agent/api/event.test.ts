// @ts-nocheck
import { subscribeEvents, initEvents } from './event';
import * as event from '../../event';
import { getVersion } from '../../configuration';

jest.mock('../../event');
jest.mock('../../configuration');
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

describe('Agent API Event', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // @ts-ignore
        getVersion.mockReturnValue('1.0.0');
    });

    test('initEvents should register event listeners', () => {
        initEvents();
        expect(event.registerContainerAdded).toHaveBeenCalled();
        expect(event.registerContainerUpdated).toHaveBeenCalled();
        expect(event.registerContainerRemoved).toHaveBeenCalled();
    });

    test('subscribeEvents should set headers and send ack', () => {
        const req = {
            ip: '127.0.0.1',
            on: jest.fn(),
        };
        const res = {
            writeHead: jest.fn(),
            write: jest.fn(),
        };

        subscribeEvents(req, res);

        expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
            'Content-Type': 'text/event-stream',
        }));
        expect(res.write).toHaveBeenCalledWith(
            expect.stringContaining('wud:ack'),
        );
    });

    test('should send events to connected clients', () => {
        // Setup client
        const req = { ip: '127.0.0.1', on: jest.fn() };
        const res = { writeHead: jest.fn(), write: jest.fn() };
        subscribeEvents(req, res);

        // Reset write mock to ignore ack
        res.write.mockClear();

        // Trigger event
        initEvents();
        const containerAddedHandler = event.registerContainerAdded.mock.calls[0][0];
        containerAddedHandler({ id: 'c1', name: 'c1' });

        expect(res.write).toHaveBeenCalledWith(
            expect.stringContaining('wud:container-added'),
        );
    });
});
