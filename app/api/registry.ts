// @ts-nocheck
import component from './component';

/**
 * Init Router.
 * @returns {*}
 */
function init() {
    const router = component.init('registry');
    return router;
}

export default {
    init,
};
