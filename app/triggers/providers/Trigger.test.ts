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
            expect(spy).toHaveBeenCalledWith({
                name: 'container1',
                updateAvailable: item.updateAvailable,
                updateKind: {
                    kind: 'tag',
                    semverDiff: item.semverDiff,
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
            expect(spy).toHaveBeenCalledWith([
                {
                    name: 'container1',
                    updateAvailable: item.updateAvailable,
                    updateKind: {
                        kind: 'tag',
                        semverDiff: item.semverDiff,
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
