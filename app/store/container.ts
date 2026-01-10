// @ts-nocheck
/**
 * Container store.
 */
import { byString, byValues  } from 'sort-es';
import logger from '../log';
const log = logger.child({ component: 'store' });
import container from '../model/container';
const { validate: validateContainer } = container;
import { emitContainerAdded,
    emitContainerUpdated,
    emitContainerRemoved,
 } from '../event';

let containers;

/**
 * Create container collections.
 * @param db
 */
function createCollections(db) {
    containers = db.getCollection('containers');
    if (containers === null) {
        log.info('Create Collection containers');
        containers = db.addCollection('containers');
    }
}

/**
 * Insert new Container.
 * @param container
 */
function insertContainer(container) {
    const containerToSave = validateContainer(container);
    containers.insert({
        data: containerToSave,
    });
    emitContainerAdded(containerToSave);
    return containerToSave;
}

/**
 * Update existing container.
 * @param container
 */
function updateContainer(container) {
    const containerToReturn = validateContainer(container);

    // Remove existing container
    containers
        .chain()
        .find({
            'data.id': container.id,
        })
        .remove();

    // Insert new one
    containers.insert({
        data: containerToReturn,
    });
    emitContainerUpdated(containerToReturn);
    return containerToReturn;
}

/**
 * Get all (filtered) containers.
 * @param query
 * @returns {*}
 */
function getContainers(query = {}) {
    const filter = {};
    Object.keys(query).forEach((key) => {
        filter[`data.${key}`] = query[key];
    });
    if (!containers) {
        return [];
    }
    const containerList = containers
        .find(filter)
        .map((item) => validateContainer(item.data));
    return containerList.sort(
        byValues([
            [(container) => container.watcher, byString()],
            [(container) => container.name, byString()],
            [(container) => container.image.tag.value, byString()],
        ]),
    );
}

/**
 * Get container by id.
 * @param id
 * @returns {null|Image}
 */
function getContainer(id) {
    const container = containers.findOne({
        'data.id': id,
    });

    if (container !== null) {
        return validateContainer(container.data);
    }
    return undefined;
}

/**
 * Delete container by id.
 * @param id
 */
function deleteContainer(id) {
    const container = getContainer(id);
    if (container) {
        containers
            .chain()
            .find({
                'data.id': id,
            })
            .remove();
        emitContainerRemoved(container);
    }
}

export {
    createCollections,
    insertContainer,
    updateContainer,
    getContainers,
    getContainer,
    deleteContainer,
};
export default {
    createCollections,
    insertContainer,
    updateContainer,
    getContainers,
    getContainer,
    deleteContainer,
};
