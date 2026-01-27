import { getContainerTriggers } from './container';
import * as storeContainer from '../store/container';
import * as registry from '../registry';

jest.mock('../store/container');
jest.mock('../registry');
jest.mock('./component');
jest.mock('../triggers/providers/Trigger');

describe('Container API', () => {
    const mockRes = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
        sendStatus: jest.fn(),
    };

    beforeEach(() => {
        jest.clearAllMocks();
        (registry.getState as jest.Mock).mockReturnValue({ trigger: {} });
    });

    describe('getContainerTriggers', () => {
        const mockTrigger1 = {
            getId: () => 'docker.t1',
            type: 'docker',
            name: 't1',
            configuration: { threshold: 'all' },
            apply: jest.fn(),
            maskConfiguration: jest.fn(),
        };
        const mockTrigger2 = {
            getId: () => 'slack.t2',
            type: 'slack',
            name: 't2',
            configuration: {},
            apply: jest.fn(),
            maskConfiguration: jest.fn(),
        };

        beforeEach(() => {
            (registry.getState as jest.Mock).mockReturnValue({
                trigger: {
                    'docker.t1': mockTrigger1,
                    'slack.t2': mockTrigger2,
                },
            });
            mockTrigger1.apply.mockReset();
            mockTrigger2.apply.mockReset();
            mockTrigger1.maskConfiguration.mockReset();
            mockTrigger2.maskConfiguration.mockReset();
        });

        test('should return 404 if container is not found', async () => {
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                undefined,
            );
            const req = { params: { id: 'unknown' } };

            await getContainerTriggers(req, mockRes);

            expect(mockRes.sendStatus).toHaveBeenCalledWith(404);
        });

        test('should return triggers that are applicable', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            mockTrigger1.apply.mockReturnValue(mockTrigger1.configuration);
            mockTrigger1.maskConfiguration.mockReturnValue(
                mockTrigger1.configuration,
            );

            mockTrigger2.apply.mockReturnValue(undefined); // Not applicable

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockTrigger1.apply).toHaveBeenCalledWith(container);
            expect(mockTrigger2.apply).toHaveBeenCalledWith(container);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ name: 't1' }),
            ]);
            // check t2 not present
            const response = mockRes.json.mock.calls[0][0];
            expect(response).toHaveLength(1);
            expect(response[0].name).toBe('t1');
        });

        test('should return triggers sorted by type and name', async () => {
            const container = { id: 'c1' };
            (storeContainer.getContainer as jest.Mock).mockReturnValue(
                container,
            );

            // t1 is docker, t2 is slack. docker < slack.
            mockTrigger1.apply.mockReturnValue(mockTrigger1.configuration);
            mockTrigger1.maskConfiguration.mockReturnValue(
                mockTrigger1.configuration,
            );
            mockTrigger2.apply.mockReturnValue(mockTrigger2.configuration);
            mockTrigger2.maskConfiguration.mockReturnValue(
                mockTrigger2.configuration,
            );

            const req = { params: { id: 'c1' } };
            await getContainerTriggers(req, mockRes);

            expect(mockRes.json).toHaveBeenCalledWith([
                expect.objectContaining({ type: 'docker', name: 't1' }),
                expect.objectContaining({ type: 'slack', name: 't2' }),
            ]);
        });
    });
});
