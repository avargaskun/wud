import { deleteContainer } from './container';
import * as storeContainer from '../store/container';
import * as manager from '../agent/manager';
import { getServerConfiguration } from '../configuration';

jest.mock('../store/container');
jest.mock('../agent/manager');
jest.mock('../configuration');
jest.mock('../log', () => ({
    child: jest.fn().mockReturnThis(),
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
}));

describe('Container API - deleteContainer', () => {
    const mockRes = {
        status: jest.fn().mockReturnThis(),
        sendStatus: jest.fn(),
        json: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (getServerConfiguration as jest.Mock).mockReturnValue({
            feature: { delete: true },
        });
    });

    test('should return 403 if delete feature is disabled', async () => {
        (getServerConfiguration as jest.Mock).mockReturnValue({
            feature: { delete: false },
        });
        const req = { params: { id: 'c1' } } as any;

        await deleteContainer(req, mockRes);

        expect(mockRes.sendStatus).toHaveBeenCalledWith(403);
    });

    test('should return 404 if container not found', async () => {
        (storeContainer.getContainer as jest.Mock).mockReturnValue(undefined);
        const req = { params: { id: 'c1' } } as any;

        await deleteContainer(req, mockRes);

        expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
    });

    test('should delete local container', async () => {
        const container = { id: 'c1' };
        (storeContainer.getContainer as jest.Mock).mockReturnValue(container);
        const req = { params: { id: 'c1' } } as any;

        await deleteContainer(req, mockRes);

        expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
        expect(mockRes.sendStatus).toHaveBeenCalledWith(204);
    });

    test('should proxy delete to agent for remote container', async () => {
        const container = { id: 'c1', agent: 'agent1' };
        (storeContainer.getContainer as jest.Mock).mockReturnValue(container);
        const mockAgent = {
            deleteContainer: jest.fn().mockResolvedValue(undefined),
        };
        (manager.getAgent as jest.Mock).mockReturnValue(mockAgent);

        const req = { params: { id: 'c1' } } as any;

        await deleteContainer(req, mockRes);

        expect(mockAgent.deleteContainer).toHaveBeenCalledWith('c1');
        expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
        expect(mockRes.sendStatus).toHaveBeenCalledWith(204);
    });

    test('should handle agent error (non-404)', async () => {
        const container = { id: 'c1', agent: 'agent1' };
        (storeContainer.getContainer as jest.Mock).mockReturnValue(container);
        const mockAgent = {
            deleteContainer: jest.fn().mockRejectedValue(new Error('error')),
        };
        (manager.getAgent as jest.Mock).mockReturnValue(mockAgent);

        const req = { params: { id: 'c1' } } as any;

        await deleteContainer(req, mockRes);

        expect(mockAgent.deleteContainer).toHaveBeenCalledWith('c1');
        expect(storeContainer.deleteContainer).not.toHaveBeenCalled();
        expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    test('should delete locally if agent returns 404', async () => {
        const container = { id: 'c1', agent: 'agent1' };
        (storeContainer.getContainer as jest.Mock).mockReturnValue(container);
        const error: any = new Error('Not found');
        error.response = { status: 404 };
        const mockAgent = {
            deleteContainer: jest.fn().mockRejectedValue(error),
        };
        (manager.getAgent as jest.Mock).mockReturnValue(mockAgent);

        const req = { params: { id: 'c1' } } as any;

        await deleteContainer(req, mockRes);

        expect(mockAgent.deleteContainer).toHaveBeenCalledWith('c1');
        expect(storeContainer.deleteContainer).toHaveBeenCalledWith('c1');
        expect(mockRes.sendStatus).toHaveBeenCalledWith(204);
    });
});
