import Component, { ComponentConfiguration } from '../../registry/Component';
import * as event from '../../event';
import { getTriggerCounter } from '../../prometheus/trigger';
import { fullName, Container, ContainerReport } from '../../model/container';
import { ObjectSchema } from 'joi';

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
        if (
            threshold.toLowerCase() !== 'all' &&
            containerResult.updateKind &&
            containerResult.updateKind.kind === 'tag' &&
            containerResult.updateKind.semverDiff &&
            containerResult.updateKind.semverDiff !== 'unknown'
        ) {
            switch (threshold) {
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
                default:
                    thresholdPassing = true;
            }
        }
        return thresholdPassing;
    }

    /**
     * Parse $name:$threshold string.
     * @param {*} includeOrExcludeTriggerString
     * @returns
     */
    static parseIncludeOrIncludeTriggerString(
        includeOrExcludeTriggerString: string,
    ) {
        const includeOrExcludeTriggerSplit =
            includeOrExcludeTriggerString.split(/\s*:\s*/);
        const includeOrExcludeTrigger = {
            id: includeOrExcludeTriggerSplit[0],
            threshold: 'all',
        };
        if (includeOrExcludeTriggerSplit.length === 2) {
            switch (includeOrExcludeTriggerSplit[1]) {
                case 'major-only':
                    includeOrExcludeTrigger.threshold = 'major-only';
                    break;
                case 'minor-only':
                    includeOrExcludeTrigger.threshold = 'minor-only';
                    break;
                case 'major':
                    includeOrExcludeTrigger.threshold = 'major';
                    break;
                case 'minor':
                    includeOrExcludeTrigger.threshold = 'minor';
                    break;
                case 'patch':
                    includeOrExcludeTrigger.threshold = 'patch';
                    break;
                default:
                    includeOrExcludeTrigger.threshold = 'all';
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
            if (includedTrigger) {
                isIncluded = true;
                configuration.threshold = includedTrigger.threshold;
            } else {
                isIncluded = false;
            }
        }

        if (
            excludedTriggers &&
            excludedTriggers
                .map((excludedTrigger) => excludedTrigger.id)
                .includes(triggerId)
        ) {
            isIncluded = false;
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
                } else if (
                    !Trigger.isThresholdReached(
                        containerReport.container,
                        (
                            effectiveConfiguration.threshold || 'all'
                        ).toLowerCase(),
                    )
                ) {
                    logContainer.debug('Threshold not reached => ignore');
                } else {
                    logContainer.debug('Run');
                    await this.trigger(containerReport.container);
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
                        if (
                            effectiveConfiguration &&
                            Trigger.isThresholdReached(
                                containerReport.container,
                                (
                                    effectiveConfiguration.threshold || 'all'
                                ).toLowerCase(),
                            )
                        ) {
                            containersFiltered.push(containerReport.container);
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

    isTriggerIncludedOrExcluded(containerResult: Container, trigger: string) {
        const triggers = trigger
            .split(/\s*,\s*/)
            .map((triggerToMatch) =>
                Trigger.parseIncludeOrIncludeTriggerString(triggerToMatch),
            );
        const triggerMatched = triggers.find(
            (triggerToMatch) =>
                triggerToMatch.id.toLowerCase() === this.getId(),
        );
        if (!triggerMatched) {
            return false;
        }
        return Trigger.isThresholdReached(
            containerResult,
            triggerMatched.threshold.toLowerCase(),
        );
    }

    isTriggerIncluded(
        containerResult: Container,
        triggerInclude: string | undefined,
    ) {
        if (!triggerInclude) {
            return this.configuration.includebydefault !== false;
        }
        return this.isTriggerIncludedOrExcluded(
            containerResult,
            triggerInclude,
        );
    }

    isTriggerExcluded(
        containerResult: Container,
        triggerExclude: string | undefined,
    ) {
        if (!triggerExclude) {
            return false;
        }
        return this.isTriggerIncludedOrExcluded(
            containerResult,
            triggerExclude,
        );
    }

    /**
     * Return true if must trigger on this container.
     */
    mustTrigger(containerResult: Container) {
        const { triggerInclude, triggerExclude } = containerResult;
        return (
            this.isTriggerIncluded(containerResult, triggerInclude) &&
            !this.isTriggerExcluded(containerResult, triggerExclude)
        );
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
    async trigger(_containerWithResult: Container) {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container result; this trigger does not implement "simple" mode',
        );
    }

    /**
     * Trigger batch method. Must be overridden in trigger implementation class.
     */
    async triggerBatch(_containersWithResult: Container[]) {
        // do nothing by default
        this.log.warn(
            'Cannot trigger container results; this trigger does not implement "batch" mode',
        );
    }

    /**
     * Return the subset of containers this trigger cannot process as part of a
     * lockstep batch. Default: none. Overridden by providers (e.g. docker-compose)
     * that can only act on containers belonging to a managed resource.
     * @param containers
     * @returns {Promise<Container[]>}
     */

    async getUnbatchableContainers(
        containers: Container[],
    ): Promise<Container[]> {
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
