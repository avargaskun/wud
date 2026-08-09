import Component, { ComponentConfiguration } from '../../registry/Component';
import * as event from '../../event';
import { getTriggerCounter } from '../../prometheus/trigger';
import {
    fullName,
    Container,
    ContainerReport,
    ContainerUpdate,
    UpdateBucketKey,
} from '../../model/container';
import { ObjectSchema } from 'joi';
import type { TriggerRunResult } from './docker/types';

export interface TriggerConfiguration extends ComponentConfiguration {
    auto?: boolean;
    threshold?: string;
    mode?: string;
    once?: boolean;
    simpletitle?: string;
    simplebody?: string;
    batchtitle?: string;
    includebydefault?: boolean;
}

export interface UnprocessableContainer {
    container: Container;
    reason: string;
}

export interface ParsedIncludeOrExcludeTrigger {
    id: string;
    threshold: string;
    thresholdInvalid: boolean;
    thresholdPresent: boolean;
    thresholdToken?: string;
}

/**
 * Render body or title simple template.
 * @param template
 * @param container
 * @returns {*}
 */
function renderSimple(template: string, container: Container) {
    // Set deprecated vars for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const id = container.id;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const name = container.name;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const watcher = container.watcher;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const kind =
        container.updateKind && container.updateKind.kind
            ? container.updateKind.kind
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const semver =
        container.updateKind && container.updateKind.semverDiff
            ? container.updateKind.semverDiff
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const local =
        container.updateKind && container.updateKind.localValue
            ? container.updateKind.localValue
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const remote =
        container.updateKind && container.updateKind.remoteValue
            ? container.updateKind.remoteValue
            : '';
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const link =
        container.result && container.result.link ? container.result.link : '';

    return eval('`' + template + '`');
}

function renderBatch(template: string, containers: Container[]) {
    // Set deprecated vars for backward compatibility
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const count = containers ? containers.length : 0;

    return eval('`' + template + '`');
}

/**
 * Trigger base component.
 */
class Trigger extends Component {
    public configuration: TriggerConfiguration = {};
    public strictAgentMatch = false;

    /**
     * Return true if update reaches trigger threshold.
     * @param containerResult
     * @param threshold
     * @returns {boolean}
     */
    static isThresholdReached(containerResult: Container, threshold: string) {
        let thresholdPassing = true;
        const t = threshold.toLowerCase();
        if (
            t !== 'all' &&
            containerResult.updateKind &&
            containerResult.updateKind.kind === 'tag' &&
            containerResult.updateKind.semverDiff &&
            containerResult.updateKind.semverDiff !== 'unknown'
        ) {
            switch (t) {
                case 'major-only':
                    thresholdPassing =
                        containerResult.updateKind.semverDiff == 'major';
                    break;
                case 'minor-only':
                    thresholdPassing =
                        containerResult.updateKind.semverDiff == 'minor';
                    break;
                case 'minor':
                    thresholdPassing =
                        containerResult.updateKind.semverDiff !== 'major';
                    break;
                case 'patch':
                    thresholdPassing =
                        containerResult.updateKind.semverDiff !== 'major' &&
                        containerResult.updateKind.semverDiff !== 'minor';
                    break;
                case 'digest':
                    thresholdPassing = false;
                    break;
                default:
                    thresholdPassing = true;
            }
        }
        return thresholdPassing;
    }

    /**
     * Return the update buckets a threshold allows to be installed.
     * The threshold is a ceiling on eligible buckets, not a filter on the highest one.
     * digest is eligible at every threshold except 'digest', which is digest-only.
     * @param threshold
     * @returns {UpdateBucketKey[]}
     */
    static getEligibleBuckets(threshold: string): UpdateBucketKey[] {
        switch (threshold.toLowerCase()) {
            case 'minor':
                return ['minor', 'patch', 'digest'];
            case 'patch':
                return ['patch', 'digest'];
            case 'major-only':
                return ['major', 'digest'];
            case 'minor-only':
                return ['minor', 'digest'];
            case 'digest':
                return ['digest'];
            case 'all':
            case 'major':
            default:
                return ['major', 'minor', 'patch', 'digest'];
        }
    }

    /**
     * Describe an update that could not be bucketed, from the legacy result/updateKind fields.
     * kind 'unknown' is mapped to 'digest' (target = the current tag) because the legacy path
     * would otherwise produce getImageFullName(image, undefined).
     * @param container
     * @returns {ContainerUpdate}
     */
    static legacyUpdate(container: Container): ContainerUpdate {
        const uk = container.updateKind;
        const isTag = uk?.kind === 'tag';
        return {
            kind: isTag ? 'tag' : 'digest',
            localValue:
                (isTag ? uk?.localValue : container.image?.digest?.value) ?? '',
            remoteValue:
                (isTag ? uk?.remoteValue : container.result?.digest) ?? '',
            semverDiff:
                uk?.semverDiff === 'unknown' ? undefined : uk?.semverDiff,
            created: container.result?.created,
            link: container.result?.link,
        };
    }

    /**
     * Return the highest update the threshold permits to be installed, if any.
     * Precedence is major -> minor -> patch -> digest.
     * @param container
     * @param threshold
     * @returns {ContainerUpdate|undefined}
     */
    static selectUpdate(
        container: Container,
        threshold: string,
    ): ContainerUpdate | undefined {
        const eligible = Trigger.getEligibleBuckets(threshold);
        const updates = container.updates;
        if (updates) {
            for (const key of ['major', 'minor', 'patch'] as const) {
                if (eligible.includes(key) && updates[key]) return updates[key];
            }
            if (eligible.includes('digest') && updates.digest)
                return updates.digest;
        }
        // Legacy fallback: updates that cannot be bucketed at all
        if (
            container.updateAvailable &&
            Trigger.isThresholdReached(container, threshold)
        ) {
            const legacy = Trigger.legacyUpdate(container);
            // isThresholdReached cannot judge a tag update whose semverDiff is unknown or absent
            if (
                legacy.kind === 'digest' ||
                eligible.some((b) => b !== 'digest')
            )
                return legacy;
        }
        return undefined;
    }

    /**
     * Build the shallow container view describing the selected update.
     * The spread evaluates the computed getters into plain values before they are overwritten.
     * @param container
     * @param update
     * @returns {Container}
     */
    static buildTriggerView(
        container: Container,
        update: ContainerUpdate,
    ): Container {
        const view: any = { ...container };
        view.result = {
            ...container.result,
            tag:
                update.kind === 'tag'
                    ? update.remoteValue
                    : container.image.tag.value,
            digest:
                update.kind === 'digest'
                    ? update.remoteValue
                    : container.result?.digest,
            created: update.created ?? container.result?.created,
            link: update.link ?? container.result?.link,
        };
        view.updateKind = {
            kind: update.kind,
            localValue: update.localValue,
            remoteValue: update.remoteValue,
            semverDiff:
                update.semverDiff ??
                (update.kind === 'tag' ? 'unknown' : undefined),
        };
        view.updateAvailable = true;
        view.selectedUpdate = update;
        return view;
    }

    /**
     * Parse $name:$threshold string.
     * @param {*} includeOrExcludeTriggerString
     * @returns
     */
    static parseIncludeOrIncludeTriggerString(
        includeOrExcludeTriggerString: string,
    ): ParsedIncludeOrExcludeTrigger {
        const includeOrExcludeTriggerSplit =
            includeOrExcludeTriggerString.split(/\s*:\s*/);
        const includeOrExcludeTrigger: ParsedIncludeOrExcludeTrigger = {
            id: includeOrExcludeTriggerSplit[0],
            threshold: 'all',
            thresholdInvalid: false,
            thresholdPresent: includeOrExcludeTriggerSplit.length >= 2,
        };
        if (includeOrExcludeTrigger.thresholdPresent) {
            // Everything after the FIRST colon is the token. A well-formed entry has
            // exactly one colon; `a:b:c` is malformed and must fail closed rather than
            // silently fall back to the most permissive threshold ('all') — that is the
            // very footgun this validation exists to remove. Joining the remainder makes
            // the token unmatchable, so the switch below flags it invalid on its own, and
            // the warning can quote it. Note the split regex consumes whitespace around
            // the separators, so the quoted token is the remainder with whitespace around
            // colons normalized away -- not a verbatim copy of what the user typed.
            const thresholdToken = includeOrExcludeTriggerSplit
                .slice(1)
                .join(':');
            includeOrExcludeTrigger.thresholdToken = thresholdToken;
            // Matched case-insensitively to stay consistent with the rest of this
            // vocabulary: validateConfiguration uses joi .insensitive() and both
            // handlers lowercase the threshold before selectUpdate. The raw token is
            // kept in thresholdToken so the warning can quote what the user typed.
            const thresholdNormalized = thresholdToken.toLowerCase();
            switch (thresholdNormalized) {
                case 'major-only':
                case 'minor-only':
                case 'major':
                case 'minor':
                case 'patch':
                case 'digest':
                case 'all':
                    includeOrExcludeTrigger.threshold = thresholdNormalized;
                    break;
                default:
                    // Threshold stays 'all' so existing consumers are unaffected;
                    // apply() is what fails closed on the invalid flag.
                    includeOrExcludeTrigger.threshold = 'all';
                    includeOrExcludeTrigger.thresholdInvalid = true;
            }
        }
        return includeOrExcludeTrigger;
    }

    /**
     * Apply the trigger to the container.
     * Return the effective configuration if the trigger applies to the container.
     * Return undefined if the trigger does not apply.
     * @param container
     * @returns {TriggerConfiguration|undefined}
     */
    apply(container: Container): TriggerConfiguration | undefined {
        // Check Agent compatibility
        if (
            (this.agent || this.strictAgentMatch) &&
            this.agent !== container.agent
        ) {
            return undefined;
        }

        // Use 'local' trigger id syntax - which is the syntax that will be used in remote Agents
        const triggerId = `${this.type}.${this.name}`;

        const includedTriggers = container.triggerInclude
            ? container.triggerInclude
                  .split(/\s*,\s*/)
                  .map((includedTrigger) =>
                      Trigger.parseIncludeOrIncludeTriggerString(
                          includedTrigger.trim(),
                      ),
                  )
            : undefined;

        const excludedTriggers = container.triggerExclude
            ? container.triggerExclude
                  .split(/\s*,\s*/)
                  .map((excludedTrigger) =>
                      Trigger.parseIncludeOrIncludeTriggerString(
                          excludedTrigger.trim(),
                      ),
                  )
            : undefined;

        const configuration = { ...this.configuration };
        let isIncluded = this.configuration.includebydefault !== false;

        if (includedTriggers) {
            const includedTrigger = includedTriggers.find(
                (tr) => tr.id === triggerId,
            );
            if (!includedTrigger) {
                isIncluded = false;
            } else if (includedTrigger.thresholdInvalid) {
                // Fail closed: degrading an unrecognised token to 'all' would authorise
                // every major update on an auto-updating trigger because of a typo.
                this.log.warn(
                    `Invalid threshold [${includedTrigger.thresholdToken}] in trigger include [${triggerId}] of container [${fullName(container)}] => trigger ignored for this container`,
                );
                isIncluded = false;
            } else {
                isIncluded = true;
                configuration.threshold = includedTrigger.threshold;
            }
        }

        if (excludedTriggers) {
            const excludedTrigger = excludedTriggers.find(
                (tr) => tr.id === triggerId,
            );
            if (excludedTrigger) {
                if (excludedTrigger.thresholdPresent) {
                    this.log.warn(
                        `Threshold [${excludedTrigger.thresholdToken}] is meaningless in trigger exclude [${triggerId}] of container [${fullName(container)}] => container excluded anyway`,
                    );
                }
                isIncluded = false;
            }
        }

        if (isIncluded) {
            return configuration;
        }
        return undefined;
    }

    /**
     * Determine the effective AUTO value for a given container.
     * Checks for a per-container label override, falling back to
     * the trigger's global AUTO configuration.
     * @param container
     * @returns {boolean}
     */
    isAutoForContainer(container: Container): boolean {
        const labelKey = `wud.trigger.${this.type}.${this.name}.auto`;
        if (container.labels && labelKey in container.labels) {
            return container.labels[labelKey] === 'true';
        }
        return this.configuration.auto ?? true;
    }

    /**
     * Handle container report (simple mode).
     * @param containerReport
     * @returns {Promise<void>}
     */
    async handleContainerReport(containerReport: ContainerReport) {
        // Filter on changed containers with update available and passing trigger threshold
        if (
            (containerReport.changed || !this.configuration.once) &&
            containerReport.container.updateAvailable
        ) {
            const logContainer =
                this.log.child({
                    container: fullName(containerReport.container),
                }) || this.log;
            if (!this.isAutoForContainer(containerReport.container)) {
                logContainer.debug(
                    'Auto execution disabled for this container => skip',
                );
                return;
            }
            let status = 'error';
            try {
                const effectiveConfiguration = this.apply(
                    containerReport.container,
                );
                if (!effectiveConfiguration) {
                    logContainer.debug('Trigger conditions not met => ignore');
                } else {
                    const update = Trigger.selectUpdate(
                        containerReport.container,
                        (
                            effectiveConfiguration.threshold || 'all'
                        ).toLowerCase(),
                    );
                    if (!update) {
                        logContainer.debug(
                            'No eligible update for threshold => ignore',
                        );
                    } else {
                        logContainer.debug('Run');
                        await this.trigger(
                            Trigger.buildTriggerView(
                                containerReport.container,
                                update,
                            ),
                        );
                    }
                }
                status = 'success';
            } catch (e: any) {
                logContainer.warn(`Error (${e.message})`);
                logContainer.debug(e);
            } finally {
                this.increasePrometheusTriggerCounter(status);
            }
        }
    }

    /**
     * Increase the Prometheus trigger counter with the provided status.
     * @param status the trigger result status
     */
    increasePrometheusTriggerCounter(status: string) {
        const triggerCounter = getTriggerCounter();
        if (triggerCounter) {
            triggerCounter.inc({
                type: this.type,
                name: this.name,
                status,
            });
        }
    }

    /**
     * Handle container reports (batch mode).
     */
    async handleContainerReports(containerReports: ContainerReport[]) {
        // Filter on containers with update available and passing trigger threshold
        try {
            const containersFiltered: Container[] = [];
            containerReports.forEach((containerReport) => {
                if (containerReport.changed || !this.configuration.once) {
                    if (containerReport.container.updateAvailable) {
                        if (
                            !this.isAutoForContainer(containerReport.container)
                        ) {
                            this.log.debug(
                                `Auto execution disabled for container ${fullName(containerReport.container)} => skip`,
                            );
                            return; // skip, continue to next
                        }
                        const effectiveConfiguration = this.apply(
                            containerReport.container,
                        );
                        if (effectiveConfiguration) {
                            const update = Trigger.selectUpdate(
                                containerReport.container,
                                (
                                    effectiveConfiguration.threshold || 'all'
                                ).toLowerCase(),
                            );
                            if (update) {
                                containersFiltered.push(
                                    Trigger.buildTriggerView(
                                        containerReport.container,
                                        update,
                                    ),
                                );
                            }
                        }
                    }
                }
            });

            if (containersFiltered.length > 0) {
                this.log.debug('Run batch');
                await this.triggerBatch(containersFiltered);
            }
        } catch (e: any) {
            this.log.warn(`Error (${e.message})`);
            this.log.debug(e);
        }
    }

    /**
     * Init the Trigger.
     */
    async init() {
        await this.initTrigger();
        this.log.info(
            `Registering (auto default: ${this.configuration.auto ?? true})`,
        );
        if (
            this.configuration.mode &&
            this.configuration.mode.toLowerCase() === 'simple'
        ) {
            event.registerContainerReport(async (containerReport) =>
                this.handleContainerReport(containerReport),
            );
        }
        if (
            this.configuration.mode &&
            this.configuration.mode.toLowerCase() === 'batch'
        ) {
            event.registerContainerReports(async (containersReports) =>
                this.handleContainerReports(containersReports),
            );
        }
    }

    /**
     * Override method to merge with common Trigger options (threshold...).
     */
    validateConfiguration(
        configuration: TriggerConfiguration,
    ): TriggerConfiguration {
        const schema = this.getConfigurationSchema() as ObjectSchema;
        const schemaWithDefaultOptions = schema.append({
            auto: this.joi.bool().default(true),
            threshold: this.joi
                .string()
                .insensitive()
                .valid(
                    'all',
                    'major',
                    'minor',
                    'patch',
                    'major-only',
                    'minor-only',
                    'digest',
                )
                .default('all'),
            mode: this.joi
                .string()
                .insensitive()
                .valid('simple', 'batch')
                .default('simple'),
            once: this.joi.boolean().default(true),
            simpletitle: this.joi
                .string()
                .default(
                    'New ${container.updateKind.kind} found for container ${container.name}',
                ),
            simplebody: this.joi
                .string()
                .default(
                    'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',
                ),
            batchtitle: this.joi
                .string()
                .default('${containers.length} updates available'),
            includebydefault: this.joi.boolean(),
        });
        const schemaValidated =
            schemaWithDefaultOptions.validate(configuration);
        if (schemaValidated.warning) {
            this.log.warn(schemaValidated.warning.message);
        }
        if (schemaValidated.error) {
            throw schemaValidated.error;
        }
        return schemaValidated.value ? schemaValidated.value : {};
    }

    /**
     * Init Trigger. Can be overridden in trigger implementation class.
     */
    async initTrigger() {
        // do nothing by default
    }

    /**
     * Trigger method. Must be overridden in trigger implementation class.
     */
    async trigger(
        _containerWithResult: Container,
    ): Promise<TriggerRunResult | void> {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container result; this trigger does not implement "simple" mode',
        );
    }

    /**
     * Trigger batch method. Must be overridden in trigger implementation class.
     */
    async triggerBatch(
        _containersWithResult: Container[],
    ): Promise<TriggerRunResult | void> {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container results; this trigger does not implement "batch" mode',
        );
    }

    /**
     * Return the containers this trigger cannot act on, with the reason for each.
     * Default: none. Overridden by providers that can only act on containers
     * belonging to a managed resource (e.g. docker-compose).
     * @param _containers
     * @returns {Promise<UnprocessableContainer[]>}
     */
    async getUnprocessableContainers(
        _containers: Container[],
    ): Promise<UnprocessableContainer[]> {
        return [];
    }

    /**
     * Render trigger title simple.
     * @param container
     * @returns {*}
     */
    renderSimpleTitle(container: Container) {
        return renderSimple(this.configuration.simpletitle!, container);
    }

    /**
     * Render trigger body simple.
     * @param container
     * @returns {*}
     */
    renderSimpleBody(container: Container) {
        return renderSimple(this.configuration.simplebody!, container);
    }

    /**
     * Render trigger title batch.
     * @param containers
     * @returns {*}
     */
    renderBatchTitle(containers: Container[]) {
        return renderBatch(this.configuration.batchtitle!, containers);
    }

    /**
     * Render trigger body batch.
     * @param containers
     * @returns {*}
     */
    renderBatchBody(containers: Container[]) {
        return containers
            .map((container) => `- ${this.renderSimpleBody(container)}\n`)
            .join('\n');
    }
}

export default Trigger;
