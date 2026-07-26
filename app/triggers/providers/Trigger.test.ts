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
