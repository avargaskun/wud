// @ts-nocheck
import { getContainers } from './container';
import * as storeContainer from '../../store/container';

jest.mock('../../store/container');

describe('Agent API Container', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('getContainers should return list of containers', () => {
        const containers = [{ id: 'c1' }, { id: 'c2' }];
        // @ts-ignore
        storeContainer.getContainers.mockReturnValue(containers);

        const req = {};
        const res = { json: jest.fn() };

        getContainers(req, res);

        expect(storeContainer.getContainers).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(containers);
    });
});
