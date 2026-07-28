// @ts-nocheck
import { ValidationError } from 'joi';
import * as event from '../../event';
import log from '../../log';
import Trigger from './Trigger';

jest.mock('../../log');
jest.mock('../../event');
jest.mock('../../prometheus/trigger', () => ({
    getTriggerCounter: () => ({
        inc: () => ({}),
    }),
}));

let trigger;

const configurationValid = {
    threshold: 'all',
    once: true,
    mode: 'simple',
    auto: true,
    simpletitle:
        'New ${container.updateKind.kind} found for container ${container.name}',

    simplebody:
        'Container ${container.name} running with ${container.updateKind.kind} ${container.updateKind.localValue} can be updated to ${container.updateKind.kind} ${container.updateKind.remoteValue}${container.result && container.result.link ? "\\n" + container.result.link : ""}',

    batchtitle: '${containers.length} updates available',
    includebydefault: true,
};

beforeEach(async () => {
    jest.resetAllMocks();
    trigger = new Trigger();
    trigger.log = log;
    trigger.configuration = { ...configurationValid };
});

test('validateConfiguration should return validated configuration when valid', async () => {
    const validatedConfiguration =
        trigger.validateConfiguration(configurationValid);
    expect(validatedConfiguration).toStrictEqual(configurationValid);
});

test('validateConfiguration should throw error when invalid', async () => {
    const configuration = {
        url: 'git://xxx.com',
    };
    expect(() => {
        trigger.validateConfiguration(configuration);
    }).toThrowError(ValidationError);
});

test('init should register to container report when simple mode enabled', async () => {
    const spy = jest.spyOn(event, 'registerContainerReport');
    await trigger.init();
    expect(spy).toHaveBeenCalled();
});

test('init should register to container reports when batch mode enabled', async () => {
    const spy = jest.spyOn(event, 'registerContainerReports');
    trigger.configuration.mode = 'batch';
    await trigger.init();
    expect(spy).toHaveBeenCalled();
});

const handleContainerReportTestCases = [
    {
        shouldTrigger: true,
        threshold: 'all',
        once: true,
        changed: true,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: true,
        threshold: 'all',
        once: false,
        changed: false,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: false,
        threshold: 'minor',
        once: true,
        changed: true,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: false,
        threshold: 'minor',
        once: false,
        changed: false,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: false,
        threshold: 'minor',
        once: false,
        changed: true,
        updateAvailable: false,
        semverDiff: 'major',
    },
];

test.each(handleContainerReportTestCases)(
    'handleContainerReport should call trigger? ($shouldTrigger) when changed=$changed and updateAvailable=$updateAvailable and threshold=$threshold',
    async (item) => {
        trigger.configuration = {
            threshold: item.threshold,
            once: item.once,
            mode: 'simple',
        };
        await trigger.init();

        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: item.changed,
            container: {
                name: 'container1',
                updateAvailable: item.updateAvailable,
                updateKind: {
                    kind: 'tag',
                    semverDiff: item.semverDiff,
                },
            },
        });
        if (item.shouldTrigger) {
            // The container has no updates buckets, so selectUpdate falls back to
            // legacyUpdate and trigger() receives the resulting view.
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith({
                name: 'container1',
                updateAvailable: item.updateAvailable,
                updateKind: {
                    kind: 'tag',
                    localValue: '',
                    remoteValue: '',
                    semverDiff: item.semverDiff,
                },
                result: {
                    tag: '',
                    digest: undefined,
                    created: undefined,
                    link: undefined,
                },
                selectedUpdate: {
                    kind: 'tag',
                    localValue: '',
                    remoteValue: '',
                    semverDiff: item.semverDiff,
                    created: undefined,
                    link: undefined,
                },
            });
        } else {
            expect(spy).not.toHaveBeenCalled();
        }
    },
);

test('handleContainerReport should warn when trigger method of the trigger fails', async () => {
    trigger.configuration = {
        threshold: 'all',
        mode: 'simple',
    };
    trigger.trigger = () => {
        throw new Error('Fail!!!');
    };
    await trigger.init();
    const spyLog = jest.spyOn(log, 'warn');
    await trigger.handleContainerReport({
        changed: true,
        container: {
            name: 'container1',
            updateAvailable: true,
            image: {
                name: 'organization/image',
                tag: { value: '1.2.3', semver: true },
                digest: { watch: true, repo: 'sha256:repo' },
            },
        },
    });
    expect(spyLog).toHaveBeenCalledWith('Error (Fail!!!)');
});

const handleContainerReportsTestCases = [
    {
        shouldTrigger: true,
        threshold: 'all',
        once: true,
        changed: true,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: true,
        threshold: 'all',
        once: false,
        changed: false,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: false,
        threshold: 'minor',
        once: true,
        changed: true,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: false,
        threshold: 'minor',
        once: false,
        changed: false,
        updateAvailable: true,
        semverDiff: 'major',
    },
    {
        shouldTrigger: false,
        threshold: 'minor',
        once: false,
        changed: true,
        updateAvailable: false,
        semverDiff: 'major',
    },
];

test.each(handleContainerReportsTestCases)(
    'handleContainerReports should call triggerBatch? ($shouldTrigger) when changed=$changed and updateAvailable=$updateAvailable and threshold=$threshold',
    async (item) => {
        trigger.configuration = {
            threshold: item.threshold,
            once: item.once,
            mode: 'simple',
        };
        await trigger.init();

        const spy = jest.spyOn(trigger, 'triggerBatch');
        await trigger.handleContainerReports([
            {
                changed: item.changed,
                container: {
                    name: 'container1',
                    updateAvailable: item.updateAvailable,
                    updateKind: {
                        kind: 'tag',
                        semverDiff: item.semverDiff,
                    },
                },
            },
        ]);
        if (item.shouldTrigger) {
            // The container has no updates buckets, so selectUpdate falls back to
            // legacyUpdate and triggerBatch() receives the resulting view.
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy).toHaveBeenCalledWith([
                {
                    name: 'container1',
                    updateAvailable: item.updateAvailable,
                    updateKind: {
                        kind: 'tag',
                        localValue: '',
                        remoteValue: '',
                        semverDiff: item.semverDiff,
                    },
                    result: {
                        tag: '',
                        digest: undefined,
                        created: undefined,
                        link: undefined,
                    },
                    selectedUpdate: {
                        kind: 'tag',
                        localValue: '',
                        remoteValue: '',
                        semverDiff: item.semverDiff,
                        created: undefined,
                        link: undefined,
                    },
                },
            ]);
        } else {
            expect(spy).not.toHaveBeenCalled();
        }
    },
);

const isThresholdReachedTestCases = [
    {
        result: true,
        threshold: 'all',
        change: undefined,
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'major',
        change: 'major',
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'major',
        change: 'minor',
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'major',
        change: 'patch',
        kind: 'tag',
    },
    {
        result: false,
        threshold: 'minor',
        change: 'major',
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'minor',
        change: 'minor',
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'minor',
        change: 'patch',
        kind: 'tag',
    },
    {
        result: false,
        threshold: 'patch',
        change: 'major',
        kind: 'tag',
    },
    {
        result: false,
        threshold: 'patch',
        change: 'minor',
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'patch',
        change: 'patch',
        kind: 'tag',
    },
    {
        result: true,
        threshold: 'all',
        change: 'unknown',
        kind: 'digest',
    },
    {
        result: true,
        threshold: 'major',
        change: 'unknown',
        kind: 'digest',
    },
    {
        result: true,
        threshold: 'minor',
        change: 'unknown',
        kind: 'digest',
    },
    {
        result: true,
        threshold: 'patch',
        change: 'unknown',
        kind: 'digest',
    },
];

test.each(isThresholdReachedTestCases)(
    'isThresholdReached should return $result when threshold is $threshold and change is $change',
    (item) => {
        trigger.configuration = {
            threshold: item.threshold,
        };
        expect(
            Trigger.isThresholdReached(
                {
                    updateKind: {
                        kind: item.kind,
                        semverDiff: item.change,
                    },
                },
                trigger.configuration.threshold,
            ),
        ).toEqual(item.result);
    },
);

test('isThresholdReached should return true when there is no semverDiff regardless of the threshold', async () => {
    trigger.configuration = {
        threshold: 'all',
    };
    expect(
        Trigger.isThresholdReached(
            {
                updateKind: { kind: 'digest' },
            },
            trigger.configuration.threshold,
        ),
    ).toBeTruthy();
});

test('apply should include containers without trigger include label by default', async () => {
    trigger.type = 'smtp';
    trigger.name = 'gmail';
    delete trigger.configuration.includebydefault;

    expect(trigger.apply({})).toBeTruthy();
});

test('apply should ignore containers without trigger include label when include by default is disabled', async () => {
    trigger.type = 'dockercompose';
    trigger.name = 'local';
    trigger.configuration.includebydefault = false;

    expect(trigger.apply({})).toBeUndefined();
});

test('apply should include explicitly selected containers when include by default is disabled', async () => {
    trigger.type = 'dockercompose';
    trigger.name = 'local';
    trigger.configuration.includebydefault = false;

    expect(
        trigger.apply({
            triggerInclude: 'dockercompose.local',
        }),
    ).toBeTruthy();
});

test('apply should still honor trigger exclude when include by default is enabled', async () => {
    trigger.type = 'dockercompose';
    trigger.name = 'local';
    trigger.configuration.includebydefault = true;

    expect(
        trigger.apply({
            triggerExclude: 'dockercompose.local',
        }),
    ).toBeUndefined();
});

test('renderSimpleTitle should replace placeholders when called', async () => {
    expect(
        trigger.renderSimpleTitle({
            name: 'container-name',
            updateKind: {
                kind: 'tag',
            },
        }),
    ).toEqual('New tag found for container container-name');
});

test('renderSimpleBody should replace placeholders when called', async () => {
    expect(
        trigger.renderSimpleBody({
            name: 'container-name',
            updateKind: {
                kind: 'tag',
                localValue: '1.0.0',
                remoteValue: '2.0.0',
            },
            result: {
                link: 'http://test',
            },
        }),
    ).toEqual(
        'Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test',
    );
});

test('renderSimpleBody should replace placeholders when template is a customized one', async () => {
    trigger.configuration.simplebody =
        'Watcher ${watcher} reports container ${name} available update';
    expect(
        trigger.renderSimpleBody({
            name: 'container-name',
            watcher: 'DUMMY',
        }),
    ).toEqual(
        'Watcher DUMMY reports container container-name available update',
    );
});

test('renderSimpleBody should evaluate js functions when template is a customized one', async () => {
    trigger.configuration.simplebody =
        'Container ${name} update from ${local.substring(0, 15)} to ${remote.substring(0, 15)}';
    expect(
        trigger.renderSimpleBody({
            name: 'container-name',
            updateKind: {
                kind: 'digest',
                localValue:
                    'sha256:9a82d5773ccfcb73ba341619fd44790a30750731568c25a6e070c2c44aa30bde',
                remoteValue:
                    'sha256:6cdd479147e4d2f1f853c7205ead7e2a0b0ccbad6e3ff0986e01936cbd179c17',
            },
        }),
    ).toEqual(
        'Container container-name update from sha256:9a82d577 to sha256:6cdd4791',
    );
});

test('renderBatchTitle should replace placeholders when called', async () => {
    expect(
        trigger.renderBatchTitle([
            {
                name: 'container-name',
                updateKind: {
                    kind: 'tag',
                },
            },
        ]),
    ).toEqual('1 updates available');
});

test('renderBatchBody should replace placeholders when called', async () => {
    expect(
        trigger.renderBatchBody([
            {
                name: 'container-name',
                updateKind: {
                    kind: 'tag',
                    localValue: '1.0.0',
                    remoteValue: '2.0.0',
                },
                result: {
                    link: 'http://test',
                },
            },
        ]),
    ).toEqual(
        '- Container container-name running with tag 1.0.0 can be updated to tag 2.0.0\nhttp://test\n',
    );
});

describe('apply', () => {
    test('should return configuration if container has no include/exclude', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        const container = { id: 'c1' };
        expect(trigger.apply(container)).toEqual(trigger.configuration);
    });

    test('should return undefined if trigger is agent and container is local', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.agent = 'agent1';
        const container = { id: 'c1' };
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('should return undefined if trigger is agent and container is from another agent', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.agent = 'agent1';
        const container = { id: 'c1', agent: 'agent2' };
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('should return configuration if trigger is agent and container is from same agent', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.agent = 'agent1';
        const container = { id: 'c1', agent: 'agent1' };
        expect(trigger.apply(container)).toEqual(trigger.configuration);
    });

    test('should return configuration if trigger is in include list', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        const container = { id: 'c1', triggerInclude: 'docker.t1' };
        expect(trigger.apply(container)).toEqual(trigger.configuration);
    });

    test('should return configuration with overridden threshold if trigger is in include list with threshold', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.configuration.threshold = 'all';
        const container = { id: 'c1', triggerInclude: 'docker.t1:major' };
        const expectedConfig = { ...trigger.configuration, threshold: 'major' };
        expect(trigger.apply(container)).toEqual(expectedConfig);
    });

    test('should return undefined if trigger is not in include list', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        const container = { id: 'c1', triggerInclude: 'docker.t2' };
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('should return undefined if trigger is in exclude list', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        const container = { id: 'c1', triggerExclude: 'docker.t1' };
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('should return undefined if trigger is in exclude list even if in include list', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        const container = {
            id: 'c1',
            triggerInclude: 'docker.t1',
            triggerExclude: 'docker.t1',
        };
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('should handle spaces in include/exclude strings', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        const container = { id: 'c1', triggerInclude: ' docker.t1 ' };
        expect(trigger.apply(container)).toEqual(trigger.configuration);
    });

    test('should return undefined if strictAgentMatch is true and trigger is local but container is remote', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.strictAgentMatch = true;
        const container = { id: 'c1', agent: 'agent1' };
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('should return configuration if strictAgentMatch is true and trigger is local and container is local', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.strictAgentMatch = true;
        const container = { id: 'c1' };
        expect(trigger.apply(container)).toEqual(trigger.configuration);
    });

    test('should return configuration if strictAgentMatch is true and trigger is agent and container is same agent', () => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.agent = 'agent1';
        trigger.strictAgentMatch = true;
        const container = { id: 'c1', agent: 'agent1' };
        expect(trigger.apply(container)).toEqual(trigger.configuration);
    });
});

describe('isAutoForContainer', () => {
    beforeEach(() => {
        trigger.type = 'docker';
        trigger.name = 't1';
    });

    test('should return true when no label present and trigger AUTO=true', () => {
        trigger.configuration.auto = true;
        const container = { id: 'c1', labels: { 'some.other.label': 'value' } };
        expect(trigger.isAutoForContainer(container)).toBe(true);
    });

    test('should return false when no label present and trigger AUTO=false', () => {
        trigger.configuration.auto = false;
        const container = { id: 'c1', labels: { 'some.other.label': 'value' } };
        expect(trigger.isAutoForContainer(container)).toBe(false);
    });

    test('should return true when label=true overrides trigger AUTO=false (opt-in)', () => {
        trigger.configuration.auto = false;
        const container = {
            id: 'c1',
            labels: { 'wud.trigger.docker.t1.auto': 'true' },
        };
        expect(trigger.isAutoForContainer(container)).toBe(true);
    });

    test('should return false when label=false overrides trigger AUTO=true (opt-out)', () => {
        trigger.configuration.auto = true;
        const container = {
            id: 'c1',
            labels: { 'wud.trigger.docker.t1.auto': 'false' },
        };
        expect(trigger.isAutoForContainer(container)).toBe(false);
    });

    test('should treat invalid label value as false', () => {
        trigger.configuration.auto = true;
        const container = {
            id: 'c1',
            labels: { 'wud.trigger.docker.t1.auto': 'banana' },
        };
        expect(trigger.isAutoForContainer(container)).toBe(false);
    });

    test('should ignore label for a different trigger', () => {
        trigger.configuration.auto = true;
        const container = {
            id: 'c1',
            labels: { 'wud.trigger.slack.other.auto': 'false' },
        };
        expect(trigger.isAutoForContainer(container)).toBe(true);
    });

    test('should return true when container labels field is undefined and trigger AUTO=true', () => {
        trigger.configuration.auto = true;
        const container = { id: 'c1' };
        expect(trigger.isAutoForContainer(container)).toBe(true);
    });

    test('should return false when container has empty labels object and trigger AUTO=false', () => {
        trigger.configuration.auto = false;
        const container = { id: 'c1', labels: {} };
        expect(trigger.isAutoForContainer(container)).toBe(false);
    });
});

describe('init auto registration', () => {
    test('should register for container report when AUTO=false and mode=simple', async () => {
        const spy = jest.spyOn(event, 'registerContainerReport');
        trigger.configuration.auto = false;
        trigger.configuration.mode = 'simple';
        await trigger.init();
        expect(spy).toHaveBeenCalled();
    });

    test('should register for container reports (batch) when AUTO=false and mode=batch', async () => {
        const spy = jest.spyOn(event, 'registerContainerReports');
        trigger.configuration.auto = false;
        trigger.configuration.mode = 'batch';
        await trigger.init();
        expect(spy).toHaveBeenCalled();
    });

    test('should register for container report when AUTO=true and mode=simple (existing behavior)', async () => {
        const spy = jest.spyOn(event, 'registerContainerReport');
        trigger.configuration.auto = true;
        trigger.configuration.mode = 'simple';
        await trigger.init();
        expect(spy).toHaveBeenCalled();
    });
});

describe('handleContainerReport auto filtering', () => {
    beforeEach(() => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.configuration.mode = 'simple';
        trigger.configuration.threshold = 'all';
    });

    const makeContainerReport = (labels, extra) => ({
        changed: true,
        container: {
            name: 'container1',
            updateAvailable: true,
            updateKind: { kind: 'tag', semverDiff: 'major' },
            labels,
            ...extra,
        },
    });

    test('should not call trigger when AUTO=false and no label', async () => {
        trigger.configuration.auto = false;
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport(makeContainerReport(undefined));
        expect(spy).not.toHaveBeenCalled();
    });

    test('should call trigger when AUTO=false and label=true (opt-in)', async () => {
        trigger.configuration.auto = false;
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport(
            makeContainerReport({ 'wud.trigger.docker.t1.auto': 'true' }),
        );
        expect(spy).toHaveBeenCalled();
    });

    test('should not call trigger when AUTO=true and label=false (opt-out)', async () => {
        trigger.configuration.auto = true;
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport(
            makeContainerReport({ 'wud.trigger.docker.t1.auto': 'false' }),
        );
        expect(spy).not.toHaveBeenCalled();
    });

    test('should call trigger when AUTO=true and no label (default behavior)', async () => {
        trigger.configuration.auto = true;
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport(makeContainerReport(undefined));
        expect(spy).toHaveBeenCalled();
    });

    test('should not call trigger when label=true but container is excluded', async () => {
        trigger.configuration.auto = false;
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport(
            makeContainerReport(
                { 'wud.trigger.docker.t1.auto': 'true' },
                { triggerExclude: 'docker.t1' },
            ),
        );
        expect(spy).not.toHaveBeenCalled();
    });

    test('should emit debug log when auto=false skips container', async () => {
        trigger.configuration.auto = false;
        const mockDebug = jest.fn();
        trigger.log = {
            ...log,
            child: () => ({ debug: mockDebug }),
        };
        await trigger.handleContainerReport(makeContainerReport(undefined));
        expect(mockDebug).toHaveBeenCalledWith(
            'Auto execution disabled for this container => skip',
        );
    });
});

describe('handleContainerReports auto filtering', () => {
    beforeEach(() => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.configuration.mode = 'batch';
        trigger.configuration.threshold = 'all';
    });

    const makeReport = (name, labels) => ({
        changed: true,
        container: {
            name,
            updateAvailable: true,
            updateKind: { kind: 'tag', semverDiff: 'major' },
            labels,
        },
    });

    test('should only include containers with auto=true in batch (mixed overrides)', async () => {
        trigger.configuration.auto = false;
        const spy = jest.spyOn(trigger, 'triggerBatch');
        await trigger.handleContainerReports([
            makeReport('containerA', {
                'wud.trigger.docker.t1.auto': 'true',
            }),
            makeReport('containerB', undefined),
        ]);
        expect(spy).toHaveBeenCalledWith([
            expect.objectContaining({ name: 'containerA' }),
        ]);
    });

    test('should not call triggerBatch when all containers have auto=false', async () => {
        trigger.configuration.auto = true;
        const spy = jest.spyOn(trigger, 'triggerBatch');
        await trigger.handleContainerReports([
            makeReport('containerA', {
                'wud.trigger.docker.t1.auto': 'false',
            }),
            makeReport('containerB', {
                'wud.trigger.docker.t1.auto': 'false',
            }),
        ]);
        expect(spy).not.toHaveBeenCalled();
    });

    test('should call triggerBatch with all containers when AUTO=true and no labels', async () => {
        trigger.configuration.auto = true;
        const spy = jest.spyOn(trigger, 'triggerBatch');
        await trigger.handleContainerReports([
            makeReport('containerA', undefined),
            makeReport('containerB', undefined),
        ]);
        expect(spy).toHaveBeenCalledWith([
            expect.objectContaining({ name: 'containerA' }),
            expect.objectContaining({ name: 'containerB' }),
        ]);
    });
});

describe('bucket selection', () => {
    const majorBucket = {
        kind: 'tag',
        localValue: '1.2.3',
        remoteValue: '2.0.0',
        semverDiff: 'major',
        created: '2021-02-01T00:00:00.000Z',
        link: 'https://link/2.0.0',
    };
    const minorBucket = {
        kind: 'tag',
        localValue: '1.2.3',
        remoteValue: '1.9.0',
        semverDiff: 'minor',
        created: '2021-01-15T00:00:00.000Z',
        link: 'https://link/1.9.0',
    };
    const patchBucket = {
        kind: 'tag',
        localValue: '1.2.3',
        remoteValue: '1.2.9',
        semverDiff: 'patch',
        created: '2021-01-10T00:00:00.000Z',
        link: 'https://link/1.2.9',
    };
    const digestBucket = {
        kind: 'digest',
        localValue: 'sha256:local',
        remoteValue: 'sha256:remote',
        created: '2021-01-20T00:00:00.000Z',
        link: 'https://link/1.2.3',
    };

    const containerWithBuckets = (updates, extra = {}) => ({
        id: 'container-123',
        name: 'container1',
        watcher: 'local',
        image: {
            name: 'organization/image',
            tag: { value: '1.2.3', semver: true },
            digest: { watch: false, value: 'sha256:local' },
        },
        result: {
            tag: '2.0.0',
            created: '2021-02-01T00:00:00.000Z',
            link: 'https://link/2.0.0',
        },
        updateAvailable: true,
        updateKind: {
            kind: 'tag',
            localValue: '1.2.3',
            remoteValue: '2.0.0',
            semverDiff: 'major',
        },
        updates,
        ...extra,
    });

    const getEligibleBucketsTestCases = [
        { threshold: 'all', buckets: ['major', 'minor', 'patch', 'digest'] },
        { threshold: 'major', buckets: ['major', 'minor', 'patch', 'digest'] },
        { threshold: 'minor', buckets: ['minor', 'patch', 'digest'] },
        { threshold: 'patch', buckets: ['patch', 'digest'] },
        { threshold: 'major-only', buckets: ['major', 'digest'] },
        { threshold: 'minor-only', buckets: ['minor', 'digest'] },
        { threshold: 'pacth', buckets: ['major', 'minor', 'patch', 'digest'] },
    ];

    test.each(getEligibleBucketsTestCases)(
        'getEligibleBuckets should return $buckets when threshold is $threshold',
        (item) => {
            expect(Trigger.getEligibleBuckets(item.threshold)).toStrictEqual(
                item.buckets,
            );
        },
    );

    test('selectUpdate should select the patch bucket at threshold patch even when a major bucket is populated', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: null,
            patch: patchBucket,
        });
        expect(Trigger.selectUpdate(container, 'patch')).toStrictEqual(
            patchBucket,
        );
    });

    test('selectUpdate should return undefined at threshold patch when only the major bucket is populated', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: null,
            patch: null,
        });
        expect(Trigger.selectUpdate(container, 'patch')).toBeUndefined();
    });

    test('selectUpdate should select the minor bucket at threshold minor-only when major and minor are populated', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: minorBucket,
            patch: null,
        });
        expect(Trigger.selectUpdate(container, 'minor-only')).toStrictEqual(
            minorBucket,
        );
    });

    test('selectUpdate should select the digest bucket at threshold patch when no eligible tag bucket is populated', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: null,
            patch: null,
            digest: digestBucket,
        });
        expect(Trigger.selectUpdate(container, 'patch')).toStrictEqual(
            digestBucket,
        );
    });

    test('selectUpdate should prefer a tag bucket over the digest bucket when both are populated', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: minorBucket,
            patch: patchBucket,
            digest: digestBucket,
        });
        expect(Trigger.selectUpdate(container, 'all')).toStrictEqual(
            majorBucket,
        );
        expect(Trigger.selectUpdate(container, 'patch')).toStrictEqual(
            patchBucket,
        );
    });

    test.each(['all', 'major', 'minor', 'patch', 'major-only', 'minor-only'])(
        'selectUpdate should fall back to the legacy update at threshold %s when no bucket can be populated',
        (threshold) => {
            const container = containerWithBuckets(
                {},
                {
                    result: {
                        tag: '1.2-rc.2',
                        created: '2021-03-01T00:00:00.000Z',
                        link: 'https://link/1.2-rc.2',
                    },
                    updateKind: {
                        kind: 'tag',
                        localValue: '1.2-rc.1',
                        remoteValue: '1.2-rc.2',
                        semverDiff: 'unknown',
                    },
                },
            );
            expect(Trigger.selectUpdate(container, threshold)).toStrictEqual({
                kind: 'tag',
                localValue: '1.2-rc.1',
                remoteValue: '1.2-rc.2',
                semverDiff: undefined,
                created: '2021-03-01T00:00:00.000Z',
                link: 'https://link/1.2-rc.2',
            });
        },
    );

    test('selectUpdate legacy fallback should still respect the threshold ceiling', () => {
        const container = containerWithBuckets(undefined);
        expect('updates' in container).toBe(true);
        expect(container.updates).toBeUndefined();
        expect(Trigger.selectUpdate(container, 'patch')).toBeUndefined();
        expect(Trigger.selectUpdate(container, 'all')).toBeDefined();
    });

    test('selectUpdate should return undefined when no update is available and no bucket is populated', () => {
        const container = containerWithBuckets(
            { major: null, minor: null, patch: null },
            { updateAvailable: false },
        );
        expect(Trigger.selectUpdate(container, 'all')).toBeUndefined();
    });

    test('legacyUpdate should map an unknown update kind to a digest update on the current tag', () => {
        const container = containerWithBuckets(
            {},
            {
                result: { created: '2021-04-01T00:00:00.000Z' },
                updateKind: { kind: 'unknown' },
            },
        );
        expect(Trigger.legacyUpdate(container)).toStrictEqual({
            kind: 'digest',
            localValue: 'sha256:local',
            remoteValue: '',
            semverDiff: undefined,
            created: '2021-04-01T00:00:00.000Z',
            link: undefined,
        });
    });

    test('legacyUpdate should use the result digest as the remote value for a digest update', () => {
        const container = containerWithBuckets(
            {},
            {
                result: {
                    digest: 'sha256:remote',
                    created: '2021-04-01T00:00:00.000Z',
                },
                updateKind: {
                    kind: 'digest',
                    localValue: 'sha256:local',
                    remoteValue: 'sha256:remote',
                },
            },
        );
        expect(Trigger.legacyUpdate(container)).toStrictEqual({
            kind: 'digest',
            localValue: 'sha256:local',
            remoteValue: 'sha256:remote',
            semverDiff: undefined,
            created: '2021-04-01T00:00:00.000Z',
            link: undefined,
        });
    });

    test('selectUpdate and buildTriggerView must be backward compatible at threshold all', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: minorBucket,
            patch: patchBucket,
        });
        const update = Trigger.selectUpdate(container, 'all');
        expect(update).toStrictEqual(majorBucket);

        const view = Trigger.buildTriggerView(container, update);
        expect(view.result.tag).toEqual(container.result.tag);
        expect(view.result.created).toEqual(container.result.created);
        expect(view.result.link).toEqual(container.result.link);
        expect(view.updateKind).toStrictEqual(container.updateKind);
        expect(view.updateAvailable).toBe(true);
    });

    test('buildTriggerView should rewrite the update kind to the selected target and expose the selected update', () => {
        const container = containerWithBuckets({
            major: majorBucket,
            minor: minorBucket,
            patch: patchBucket,
        });
        const update = Trigger.selectUpdate(container, 'patch');
        const view = Trigger.buildTriggerView(container, update);

        expect(view.updateKind).toStrictEqual({
            kind: 'tag',
            localValue: '1.2.3',
            remoteValue: '1.2.9',
            semverDiff: 'patch',
        });
        expect(view.result.tag).toEqual('1.2.9');
        expect(view.result.created).toEqual('2021-01-10T00:00:00.000Z');
        expect(view.result.link).toEqual('https://link/1.2.9');
        expect(view.updateAvailable).toBe(true);
        expect(view.selectedUpdate).toStrictEqual(patchBucket);
        // the source container must not be mutated
        expect(container.updateKind.remoteValue).toEqual('2.0.0');
        expect(container.result.tag).toEqual('2.0.0');
        expect('selectedUpdate' in container).toBe(false);
    });

    test('buildTriggerView should keep the current tag when the selected update is a digest update', () => {
        const container = containerWithBuckets({
            major: null,
            minor: null,
            patch: null,
            digest: digestBucket,
        });
        const view = Trigger.buildTriggerView(container, digestBucket);

        expect(view.result.tag).toEqual(container.image.tag.value);
        expect(view.result.digest).toEqual('sha256:remote');
        expect(view.updateKind).toStrictEqual({
            kind: 'digest',
            localValue: 'sha256:local',
            remoteValue: 'sha256:remote',
            semverDiff: undefined,
        });
        expect(view.selectedUpdate).toStrictEqual(digestBucket);
    });

    test('buildTriggerView should mark a tag update with no semver diff as unknown', () => {
        const container = containerWithBuckets({});
        const view = Trigger.buildTriggerView(container, {
            kind: 'tag',
            localValue: '1.2-rc.1',
            remoteValue: '1.2-rc.2',
        });
        expect(view.updateKind.semverDiff).toEqual('unknown');
    });
});

describe('handler bucket wiring', () => {
    const majorBucket = {
        kind: 'tag',
        localValue: '1.2.3',
        remoteValue: '2.0.0',
        semverDiff: 'major',
        created: '2021-02-01T00:00:00.000Z',
        link: 'https://link/2.0.0',
    };
    const patchBucket = {
        kind: 'tag',
        localValue: '1.2.3',
        remoteValue: '1.2.9',
        semverDiff: 'patch',
        created: '2021-01-10T00:00:00.000Z',
        link: 'https://link/1.2.9',
    };

    const containerWithBuckets = (updates, extra = {}) => ({
        id: 'container-123',
        name: 'container1',
        watcher: 'local',
        image: {
            name: 'organization/image',
            tag: { value: '1.2.3', semver: true },
            digest: { watch: false, value: 'sha256:local' },
        },
        result: {
            tag: '2.0.0',
            created: '2021-02-01T00:00:00.000Z',
            link: 'https://link/2.0.0',
        },
        updateAvailable: true,
        updateKind: {
            kind: 'tag',
            localValue: '1.2.3',
            remoteValue: '2.0.0',
            semverDiff: 'major',
        },
        updates,
        ...extra,
    });

    beforeEach(() => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.configuration.mode = 'simple';
        trigger.configuration.auto = true;
    });

    test('handleContainerReport should install the patch update at threshold patch even when a major update exists', async () => {
        trigger.configuration.threshold = 'patch';
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: true,
            container: containerWithBuckets({
                major: majorBucket,
                minor: null,
                patch: patchBucket,
            }),
        });
        expect(spy).toHaveBeenCalledTimes(1);
        const view = spy.mock.calls[0][0];
        expect(view.updateKind).toStrictEqual({
            kind: 'tag',
            localValue: '1.2.3',
            remoteValue: '1.2.9',
            semverDiff: 'patch',
        });
        expect(view.result.tag).toEqual('1.2.9');
        expect(view.selectedUpdate).toStrictEqual(patchBucket);
    });

    test('handleContainerReport should not call trigger at threshold patch when only a major update exists', async () => {
        trigger.configuration.threshold = 'patch';
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: true,
            container: containerWithBuckets({
                major: majorBucket,
                minor: null,
                patch: null,
            }),
        });
        expect(spy).not.toHaveBeenCalled();
    });

    test('handleContainerReport at threshold all must pass a view identical to the container result and update kind', async () => {
        trigger.configuration.threshold = 'all';
        const container = containerWithBuckets({
            major: majorBucket,
            minor: null,
            patch: patchBucket,
        });
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({ changed: true, container });
        expect(spy).toHaveBeenCalledTimes(1);
        const view = spy.mock.calls[0][0];
        expect(view.updateKind).toStrictEqual(container.updateKind);
        expect(view.result.tag).toEqual(container.result.tag);
        expect(view.result.created).toEqual(container.result.created);
        expect(view.result.link).toEqual(container.result.link);
        expect(view.updateAvailable).toBe(true);
    });

    test('handleContainerReport must still respect once when the container has not changed', async () => {
        trigger.configuration.threshold = 'all';
        trigger.configuration.once = true;
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: false,
            container: containerWithBuckets({ major: majorBucket }),
        });
        expect(spy).not.toHaveBeenCalled();
    });

    test('handleContainerReport must still respect updateAvailable', async () => {
        trigger.configuration.threshold = 'all';
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: true,
            container: containerWithBuckets(
                { major: majorBucket },
                { updateAvailable: false },
            ),
        });
        expect(spy).not.toHaveBeenCalled();
    });

    test('handleContainerReport must still respect isAutoForContainer', async () => {
        trigger.configuration.threshold = 'all';
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: true,
            container: containerWithBuckets(
                { major: majorBucket },
                { labels: { 'wud.trigger.docker.t1.auto': 'false' } },
            ),
        });
        expect(spy).not.toHaveBeenCalled();
    });

    test('handleContainerReport must still respect apply', async () => {
        trigger.configuration.threshold = 'all';
        const spy = jest.spyOn(trigger, 'trigger');
        await trigger.handleContainerReport({
            changed: true,
            container: containerWithBuckets(
                { major: majorBucket },
                { triggerExclude: 'docker.t1' },
            ),
        });
        expect(spy).not.toHaveBeenCalled();
    });

    test('handleContainerReports should push views and drop containers with no eligible bucket', async () => {
        trigger.configuration.mode = 'batch';
        trigger.configuration.threshold = 'patch';
        const eligible = containerWithBuckets(
            { major: majorBucket, minor: null, patch: patchBucket },
            { name: 'containerA' },
        );
        const notEligible = containerWithBuckets(
            { major: majorBucket, minor: null, patch: null },
            { name: 'containerB' },
        );
        const spy = jest.spyOn(trigger, 'triggerBatch');
        await trigger.handleContainerReports([
            { changed: true, container: eligible },
            { changed: true, container: notEligible },
        ]);
        expect(spy).toHaveBeenCalledTimes(1);
        const batch = spy.mock.calls[0][0];
        expect(batch).toHaveLength(1);
        expect(batch[0].name).toEqual('containerA');
        // a view, not the raw container
        expect(batch[0]).not.toBe(eligible);
        expect(batch[0].selectedUpdate).toStrictEqual(patchBucket);
        expect(batch[0].updateKind.remoteValue).toEqual('1.2.9');
        expect(batch[0].result.tag).toEqual('1.2.9');
        // the source container must not be mutated
        expect(eligible.updateKind.remoteValue).toEqual('2.0.0');
        expect('selectedUpdate' in eligible).toBe(false);
    });
});

const isThresholdReachedOnlyTestCases = [
    { result: true, threshold: 'major-only', change: 'major' },
    { result: false, threshold: 'major-only', change: 'minor' },
    { result: false, threshold: 'major-only', change: 'patch' },
    { result: false, threshold: 'minor-only', change: 'major' },
    { result: true, threshold: 'minor-only', change: 'minor' },
    { result: false, threshold: 'minor-only', change: 'patch' },
];

test.each(isThresholdReachedOnlyTestCases)(
    'isThresholdReached should return $result when threshold is $threshold and change is $change',
    (item) => {
        expect(
            Trigger.isThresholdReached(
                { updateKind: { kind: 'tag', semverDiff: item.change } },
                item.threshold,
            ),
        ).toEqual(item.result);
    },
);

describe('threshold label validation', () => {
    beforeEach(() => {
        trigger.type = 'docker';
        trigger.name = 't1';
        trigger.configuration.threshold = 'all';
    });

    const containerNamed = (extra = {}) => ({
        id: 'c1',
        name: 'mycontainer',
        watcher: 'local',
        ...extra,
    });

    test('parseIncludeOrIncludeTriggerString should flag an invalid threshold token', () => {
        const parsed = Trigger.parseIncludeOrIncludeTriggerString(
            'docker.update:pacth',
        );
        expect(parsed.id).toEqual('docker.update');
        expect(parsed.thresholdPresent).toBe(true);
        expect(parsed.thresholdInvalid).toBe(true);
        expect(parsed.thresholdToken).toEqual('pacth');
        // threshold still defaults to 'all' for legacy consumers, but the entry
        // must NOT present itself as a legitimately configured 'all'
        expect(parsed.threshold).toEqual('all');
    });

    test.each(['all', 'major', 'minor', 'patch', 'major-only', 'minor-only'])(
        'parseIncludeOrIncludeTriggerString should accept the %s threshold token',
        (token) => {
            const parsed = Trigger.parseIncludeOrIncludeTriggerString(
                `docker.t1:${token}`,
            );
            expect(parsed.id).toEqual('docker.t1');
            expect(parsed.threshold).toEqual(token);
            expect(parsed.thresholdPresent).toBe(true);
            expect(parsed.thresholdInvalid).toBe(false);
            expect(parsed.thresholdToken).toEqual(token);
        },
    );

    test.each([
        ['Patch', 'patch'],
        ['PATCH', 'patch'],
        ['Major-Only', 'major-only'],
        ['ALL', 'all'],
    ])(
        'parseIncludeOrIncludeTriggerString should accept the %s threshold token case-insensitively',
        (token, expected) => {
            const parsed = Trigger.parseIncludeOrIncludeTriggerString(
                `docker.t1:${token}`,
            );
            // The rest of this vocabulary is case-insensitive (joi .insensitive() on
            // the global config, .toLowerCase() in both handlers). A case-sensitive
            // match here would set thresholdInvalid and silently stop the trigger.
            expect(parsed.thresholdInvalid).toBe(false);
            expect(parsed.threshold).toEqual(expected);
            // The raw token is preserved so the warning can quote what was typed.
            expect(parsed.thresholdToken).toEqual(token);
        },
    );

    test.each([
        ['docker.t1:', ''],
        ['docker.t1::patch', ':patch'],
    ])(
        'parseIncludeOrIncludeTriggerString should fail closed on the degenerate entry %s',
        (entry, expectedToken) => {
            const parsed = Trigger.parseIncludeOrIncludeTriggerString(entry);
            // A trailing colon is a threshold that was started and not finished. It must
            // NOT be read as "no threshold given", which would silently mean 'all' — the
            // most likely way a future refactor reintroduces the fail-open.
            expect(parsed.id).toEqual('docker.t1');
            expect(parsed.thresholdPresent).toBe(true);
            expect(parsed.thresholdInvalid).toBe(true);
            expect(parsed.thresholdToken).toEqual(expectedToken);
        },
    );

    test.each([
        'docker.t1:pacth:x',
        'docker.t1:patch:minor',
        'docker.t1:a:b:c',
    ])(
        'parseIncludeOrIncludeTriggerString should fail closed on the malformed entry %s',
        (entry) => {
            const parsed = Trigger.parseIncludeOrIncludeTriggerString(entry);
            // More than one colon is malformed. It must NOT silently fall back to the
            // most permissive threshold — that is the fail-open this validation removes.
            expect(parsed.id).toEqual('docker.t1');
            expect(parsed.thresholdPresent).toBe(true);
            expect(parsed.thresholdInvalid).toBe(true);
            // The token quoted in the warning is everything after the first colon.
            expect(parsed.thresholdToken).toEqual(
                entry.substring('docker.t1:'.length),
            );
        },
    );

    test('apply should fail closed on a multi-colon include entry', () => {
        const container = containerNamed({
            triggerInclude: 'docker.t1:patch:minor',
        });
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('apply should not fail closed on a differently-cased threshold', () => {
        const container = containerNamed({ triggerInclude: 'docker.t1:Patch' });
        expect(trigger.apply(container)).toBeDefined();
        expect(trigger.apply(container).threshold).toEqual('patch');
    });

    test('parseIncludeOrIncludeTriggerString should report no threshold when none is present', () => {
        const parsed = Trigger.parseIncludeOrIncludeTriggerString('docker.t1');
        expect(parsed.id).toEqual('docker.t1');
        expect(parsed.threshold).toEqual('all');
        expect(parsed.thresholdPresent).toBe(false);
        expect(parsed.thresholdInvalid).toBe(false);
        expect(parsed.thresholdToken).toBeUndefined();
    });

    test('apply should fail closed when the include threshold is invalid', () => {
        const container = containerNamed({ triggerInclude: 'docker.t1:pacth' });
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('apply should fail closed even when includebydefault is true', () => {
        trigger.configuration.includebydefault = true;
        const container = containerNamed({ triggerInclude: 'docker.t1:pacth' });
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('apply should log a warning naming the container, the trigger id and the offending token on an invalid include', () => {
        const spyLog = jest.spyOn(log, 'warn');
        const container = containerNamed({ triggerInclude: 'docker.t1:pacth' });
        trigger.apply(container);
        expect(spyLog).toHaveBeenCalledTimes(1);
        const message = spyLog.mock.calls[0][0];
        expect(message).toContain('local_mycontainer');
        expect(message).toContain('docker.t1');
        expect(message).toContain('pacth');
    });

    test('apply should still return the effective configuration for a valid include threshold', () => {
        const container = containerNamed({ triggerInclude: 'docker.t1:patch' });
        const spyLog = jest.spyOn(log, 'warn');
        expect(trigger.apply(container)).toEqual({
            ...trigger.configuration,
            threshold: 'patch',
        });
        expect(spyLog).not.toHaveBeenCalled();
    });

    test('apply should ignore an invalid threshold on an entry naming another trigger', () => {
        const spyLog = jest.spyOn(log, 'warn');
        const container = containerNamed({
            triggerInclude: 'docker.t2:pacth, docker.t1:patch',
        });
        expect(trigger.apply(container)).toEqual({
            ...trigger.configuration,
            threshold: 'patch',
        });
        expect(spyLog).not.toHaveBeenCalled();
    });

    test('apply should still exclude when the exclude entry carries a threshold token', () => {
        const container = containerNamed({
            triggerExclude: 'docker.t1:patch',
        });
        expect(trigger.apply(container)).toBeUndefined();
    });

    test('apply should log a warning naming the container, the trigger id and the token when a threshold is set on an exclude', () => {
        const spyLog = jest.spyOn(log, 'warn');
        const container = containerNamed({
            triggerExclude: 'docker.t1:patch',
        });
        trigger.apply(container);
        expect(spyLog).toHaveBeenCalledTimes(1);
        const message = spyLog.mock.calls[0][0];
        expect(message).toContain('local_mycontainer');
        expect(message).toContain('docker.t1');
        expect(message).toContain('patch');
    });

    test('apply should exclude with an invalid threshold token on the exclude entry without failing open', () => {
        const spyLog = jest.spyOn(log, 'warn');
        const container = containerNamed({
            triggerExclude: 'docker.t1:pacth',
        });
        expect(trigger.apply(container)).toBeUndefined();
        expect(spyLog).toHaveBeenCalledTimes(1);
    });

    test('apply should not warn when the exclude entry carries no threshold', () => {
        const spyLog = jest.spyOn(log, 'warn');
        const container = containerNamed({ triggerExclude: 'docker.t1' });
        expect(trigger.apply(container)).toBeUndefined();
        expect(spyLog).not.toHaveBeenCalled();
    });
});

describe('isTriggerIncludedOrExcluded / mustTrigger (unchanged by the parse shape change)', () => {
    beforeEach(() => {
        trigger.type = 'docker';
        trigger.name = 't1';
    });

    const patchUpdate = {
        updateKind: { kind: 'tag', semverDiff: 'patch' },
    };
    const majorUpdate = {
        updateKind: { kind: 'tag', semverDiff: 'major' },
    };

    test('isTriggerIncludedOrExcluded should return false when the trigger is not named', () => {
        expect(
            trigger.isTriggerIncludedOrExcluded(patchUpdate, 'docker.t2'),
        ).toBe(false);
    });

    test('isTriggerIncludedOrExcluded should return true when the trigger is named without a threshold', () => {
        expect(
            trigger.isTriggerIncludedOrExcluded(majorUpdate, 'docker.t1'),
        ).toBe(true);
    });

    test('isTriggerIncludedOrExcluded should apply the parsed threshold', () => {
        expect(
            trigger.isTriggerIncludedOrExcluded(majorUpdate, 'docker.t1:patch'),
        ).toBe(false);
        expect(
            trigger.isTriggerIncludedOrExcluded(patchUpdate, 'docker.t1:patch'),
        ).toBe(true);
    });

    test('isTriggerIncludedOrExcluded still degrades an invalid threshold token to all', () => {
        // These helpers are not the fail-closed path (apply() is); the additive
        // parse change must leave their behaviour exactly as it is today.
        expect(
            trigger.isTriggerIncludedOrExcluded(majorUpdate, 'docker.t1:pacth'),
        ).toBe(true);
    });

    test('isTriggerIncluded should fall back to includebydefault when no include is set', () => {
        trigger.configuration.includebydefault = true;
        expect(trigger.isTriggerIncluded(patchUpdate, undefined)).toBe(true);
        trigger.configuration.includebydefault = false;
        expect(trigger.isTriggerIncluded(patchUpdate, undefined)).toBe(false);
    });

    test('isTriggerExcluded should return false when no exclude is set', () => {
        expect(trigger.isTriggerExcluded(patchUpdate, undefined)).toBe(false);
    });

    test('mustTrigger should return true when included and not excluded', () => {
        expect(
            trigger.mustTrigger({
                ...patchUpdate,
                triggerInclude: 'docker.t1:patch',
            }),
        ).toBe(true);
    });

    test('mustTrigger should return false when excluded', () => {
        expect(
            trigger.mustTrigger({
                ...patchUpdate,
                triggerInclude: 'docker.t1',
                triggerExclude: 'docker.t1',
            }),
        ).toBe(false);
    });

    test('mustTrigger should return false when the include threshold is not reached', () => {
        expect(
            trigger.mustTrigger({
                ...majorUpdate,
                triggerInclude: 'docker.t1:patch',
            }),
        ).toBe(false);
    });
});
