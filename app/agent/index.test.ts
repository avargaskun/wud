// @ts-nocheck
import { init } from './index';
import { getState } from '../registry';
import { AgentClient } from './AgentClient';
import { addAgent } from './manager';
import log from '../log';

jest.mock('../registry');
jest.mock('./AgentClient');
jest.mock('./manager');
jest.mock('../log');

describe('agent index', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should initialize agents from registry', async () => {
        const mockAgents = {
            'agent1': {
                name: 'agent1',
                configuration: {
                    host: 'host1',
                    secret: 'secret1',
                },
            },
            'agent2': {
                name: 'agent2',
                configuration: {
                    host: 'host2',
                    secret: 'secret2',
                },
            },
        };

        // @ts-ignore
        getState.mockReturnValue({ agent: mockAgents });

        await init();

        expect(AgentClient).toHaveBeenCalledTimes(2);
        expect(addAgent).toHaveBeenCalledTimes(2);
        // Expect init to be called on client
        expect(AgentClient.prototype.init).toHaveBeenCalledTimes(2);
    });

    test('should skip agents with missing configuration', async () => {
        const mockAgents = {
            'invalid': {
                name: 'invalid',
                configuration: {
                    // host missing
                    secret: 'secret1',
                },
            },
        };

        // @ts-ignore
        getState.mockReturnValue({ agent: mockAgents });

        await init();

        expect(AgentClient).not.toHaveBeenCalled();
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Skipping agent invalid'));
    });
});
