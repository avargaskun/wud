// @ts-nocheck
import { AgentClient } from './AgentClient';
import axios from 'axios';
import * as storeContainer from '../store/container';
import * as utils from '../watchers/providers/docker/utils';
import logger from '../log';

jest.mock('axios');
jest.mock('https');
jest.mock('fs');
jest.mock('../log', () => ({
    child: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));
jest.mock('../store/container');
jest.mock('../watchers/providers/docker/utils');

describe('AgentClient', () => {
    let client;
    let mockLog;

    beforeEach(() => {
        jest.clearAllMocks();
        mockLog = {
            info: jest.fn(),
            error: jest.fn(),
            warn: jest.fn(),
            child: jest.fn().mockReturnThis(),
        };
        // @ts-ignore
        logger.child.mockReturnValue(mockLog);

        client = new AgentClient('test-agent', {
            host: 'localhost',
            port: 3000,
            secret: 'secret',
        });
    });

    test('should init and handshake', async () => {
        const containers = [{ id: '1', name: 'c1' }];
        // @ts-ignore
        axios.get.mockResolvedValue({ data: containers });
        // Mock SSE request (axios main function)
        // @ts-ignore
        axios.mockResolvedValue({ data: { on: jest.fn() } }); 
        
        // @ts-ignore
        utils.findNewVersion.mockResolvedValue({ tag: '2.0.0' });

        await client.init();

        expect(axios.get).toHaveBeenCalledWith(
            expect.stringContaining('/api/containers'),
            expect.anything()
        );
        expect(storeContainer.insertContainer).toHaveBeenCalled();
        expect(axios).toHaveBeenCalledWith(
            expect.objectContaining({ url: expect.stringContaining('/api/events') })
        );
    });
});