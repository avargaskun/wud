// @ts-nocheck
/**
 * Container store.
 */
import { byString, byValues } from 'sort-es';
import logger from '../log';
const log = logger.child({ component: 'store' });
import * as container from '../model/container';
const { validate: validateContainer } = container;
import {
    emitContainerAdded,
    emitContainerUpdated,
    emitContainerRemoved,
} from '../event';

let containers;

/**
 * Create container collections.
 * @param db
 */
export function createCollections(db) {
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
export function insertContainer(container) {
    const containerToSave = validateContainer(container);
    // selectedUpdate is a TRANSPORT-ONLY field carried by the trigger view (see design §E).
    // It must never be persisted. It is joi-legal so the view survives validation across the
    // agent hop, which also makes it storable -- and if it were stored, flatten() would emit
    // six undeclared selected_update_* keys into the Prometheus gauge. An undeclared label
    // makes prom-client throw, populateGauge swallows the throw, and the container VANISHES
    // from wud_containers with no error surfaced anywhere. Do not "clean this up".
    delete containerToSave.selectedUpdate;
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
export function updateContainer(container) {
    const containerToReturn = validateContainer(container);
    // selectedUpdate is a TRANSPORT-ONLY field carried by the trigger view (see design §E).
    // It must never be persisted. It is joi-legal so the view survives validation across the
    // agent hop, which also makes it storable -- and if it were stored, flatten() would emit
    // six undeclared selected_update_* keys into the Prometheus gauge. An undeclared label
    // makes prom-client throw, populateGauge swallows the throw, and the container VANISHES
    // from wud_containers with no error surfaced anywhere. Do not "clean this up".
    delete containerToReturn.selectedUpdate;

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
export function getContainers(query = {}) {
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
export function getContainer(id) {
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
export function deleteContainer(id) {
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
