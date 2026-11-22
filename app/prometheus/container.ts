import { Gauge, register } from 'prom-client';
import * as storeContainer from '../store/container';
import log from '../log';
import { flatten } from '../model/container';
import {
    registerContainerAdded,
    registerContainerUpdated,
    registerContainerRemoved,
} from '../event';

const CEILING_KEYS = ['ceiling_tag', 'ceiling_version'];

let gaugeContainer;
let metricsDirty = true;

/**
 * Populate gauge.
 */
function populateGauge() {
    if (!metricsDirty) {
        return;
    }

    gaugeContainer.reset();
    storeContainer.getContainers().forEach((container) => {
        try {
            const flatContainer = flatten(container);
            const flatContainerWithoutLabels = Object.keys(flatContainer)
                .filter((key) => !key.startsWith('labels_'))
                // flatten() emits null buckets and empty objects as leaves, producing
                // undeclared labels that make prom-client throw -- and the catch below
                // would silently drop the container from wud_containers entirely.
                .filter((key) => typeof flatContainer[key] !== 'object')
                // stripped here, not in flatten(), so k/v integrations keep
                // publishing the ceiling; only the allowlisted gauge needs it gone
                .filter((key) => !CEILING_KEYS.includes(key))
                .reduce((obj, key) => {
                    obj[key] = flatContainer[key];
                    return obj;
                }, {});
            gaugeContainer.set(flatContainerWithoutLabels, 1);
        } catch (e) {
            log.warn(
                `${container.id} - Error when adding container to the metrics (${e.message})`,
            );
            log.debug(e);
        }
    });
    metricsDirty = false;
}

/**
 * Init Container prometheus gauge.
 */
export function init() {
    // Replace gauge if init is called more than once
    if (gaugeContainer) {
        register.removeSingleMetric(gaugeContainer.name);
    }
    gaugeContainer = new Gauge({
        name: 'wud_containers',
        help: 'The watched containers',
        labelNames: [
            'agent',
            'display_icon',
            'display_name',
            'error_message',
            'exclude_tags',
            'id',
            'image_architecture',
            'image_created',
            'image_digest_repo',
            'image_digest_value',
            'image_digest_watch',
            'image_id',
            'image_name',
            'image_os',
            'image_registry_name',
            'image_registry_url',
            'image_tag_semver',
            'image_tag_value',
            'image_variant',
            'include_tags',
            'labels',
            'link_template',
            'link',
            'name',
            'result_created',
            'result_digest',
            'result_link',
            'result_tag',
            'status',
            'transform_tags',
            'trigger_exclude',
            'trigger_include',
            'update_available',
            'update_kind_kind',
            'update_kind_local_value',
            'update_kind_remote_value',
            'update_kind_semver_diff',
            'updates_digest_created',
            'updates_digest_kind',
            'updates_digest_link',
            'updates_digest_local_value',
            'updates_digest_remote_value',
            'updates_digest_semver_diff',
            'updates_major_created',
            'updates_major_kind',
            'updates_major_link',
            'updates_major_local_value',
            'updates_major_remote_value',
            'updates_major_semver_diff',
            'updates_minor_created',
            'updates_minor_kind',
            'updates_minor_link',
            'updates_minor_local_value',
            'updates_minor_remote_value',
            'updates_minor_semver_diff',
            'updates_patch_created',
            'updates_patch_kind',
            'updates_patch_link',
            'updates_patch_local_value',
            'updates_patch_remote_value',
            'updates_patch_semver_diff',
            'watcher',
        ],
    });
    log.debug('Start container metrics interval');
    metricsDirty = true;
    registerContainerAdded(() => {
        metricsDirty = true;
    });
    registerContainerUpdated(() => {
        metricsDirty = true;
    });
    registerContainerRemoved(() => {
        metricsDirty = true;
    });
    setInterval(populateGauge, 5000);
    populateGauge();
    return gaugeContainer;
}
