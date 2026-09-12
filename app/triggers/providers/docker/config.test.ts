import type Dockerode from 'dockerode';
import {
    COMPOSE_IMAGE_LABEL,
    emptyHints,
    mergeHints,
    refreshComposeImageLabel,
} from './config';
import type {
    ContainerConfig,
    HintedField,
    HintedHealthcheckField,
    ImageConfig,
    UserConfigHints,
} from './config';

export function containerSpec(
    overrides: Partial<
        Omit<Dockerode.ContainerInspectInfo, 'Config' | 'HostConfig'>
    > & {
        Config?: Partial<ContainerConfig>;
        HostConfig?: Partial<Dockerode.HostConfig>;
    } = {},
): Dockerode.ContainerInspectInfo {
    const { Config, HostConfig, ...rest } = overrides;
    return {
        Id: 'abcdef0123456789',
        Name: '/test',
        Config: { ...Config },
        HostConfig: { ...HostConfig },
        NetworkSettings: { Networks: {} },
        ...rest,
    } as unknown as Dockerode.ContainerInspectInfo;
}

export function imageConfig(overrides: Partial<ImageConfig> = {}): ImageConfig {
    return { ...overrides } as unknown as ImageConfig;
}

function hints(overrides: {
    envKeys?: string[];
    labelKeys?: string[];
    fields?: HintedField[];
    healthcheck?: HintedHealthcheckField[];
}): UserConfigHints {
    return {
        envKeys: new Set(overrides.envKeys ?? []),
        labelKeys: new Set(overrides.labelKeys ?? []),
        fields: new Set(overrides.fields ?? []),
        healthcheck: new Set(overrides.healthcheck ?? []),
    };
}

describe('emptyHints', () => {
    test('returns four empty sets', () => {
        const empty = emptyHints();
        expect(empty.envKeys.size).toEqual(0);
        expect(empty.labelKeys.size).toEqual(0);
        expect(empty.fields.size).toEqual(0);
        expect(empty.healthcheck.size).toEqual(0);
    });

    test('returns a fresh object on every call', () => {
        expect(emptyHints().envKeys).not.toBe(emptyHints().envKeys);
    });
});

describe('mergeHints', () => {
    test('unions every set', () => {
        const first = hints({
            envKeys: ['A'],
            labelKeys: ['l1'],
            fields: ['Cmd'],
            healthcheck: ['Test'],
        });
        const second = hints({
            envKeys: ['B'],
            labelKeys: ['l2'],
            fields: ['Entrypoint'],
            healthcheck: ['Interval'],
        });
        const merged = mergeHints(first, second);
        expect([...merged.envKeys].sort()).toEqual(['A', 'B']);
        expect([...merged.labelKeys].sort()).toEqual(['l1', 'l2']);
        expect([...merged.fields].sort()).toEqual(['Cmd', 'Entrypoint']);
        expect([...merged.healthcheck].sort()).toEqual(['Interval', 'Test']);
    });

    test('does not mutate its inputs', () => {
        const first = hints({
            envKeys: ['A'],
            labelKeys: ['l1'],
            fields: ['Cmd'],
            healthcheck: ['Test'],
        });
        const second = hints({ envKeys: ['B'] });
        mergeHints(first, second);
        expect(first.envKeys.size).toEqual(1);
        expect(first.labelKeys.size).toEqual(1);
        expect(first.fields.size).toEqual(1);
        expect(first.healthcheck.size).toEqual(1);
        expect(second.envKeys.size).toEqual(1);
        expect(second.labelKeys.size).toEqual(0);
    });

    test('with no arguments returns empty hints', () => {
        expect(mergeHints()).toEqual(emptyHints());
    });
});

describe('refreshComposeImageLabel', () => {
    test('replaces the compose image label and leaves the other labels alone', () => {
        const config = containerSpec({
            Config: {
                Labels: {
                    [COMPOSE_IMAGE_LABEL]: 'sha256:old',
                    'com.docker.compose.config-hash': 'hash',
                    'wud.tag.include': '^\\d+$',
                },
            },
        }).Config;
        const refreshed = refreshComposeImageLabel(config, 'sha256:new');
        expect(refreshed.Labels).toEqual({
            [COMPOSE_IMAGE_LABEL]: 'sha256:new',
            'com.docker.compose.config-hash': 'hash',
            'wud.tag.include': '^\\d+$',
        });
        expect(config.Labels[COMPOSE_IMAGE_LABEL]).toEqual('sha256:old');
        expect(refreshed).not.toBe(config);
    });

    test('never adds the label to a container that lacks it', () => {
        const config = containerSpec({
            Config: { Labels: { 'wud.watch': 'true' } },
        }).Config;
        const refreshed = refreshComposeImageLabel(config, 'sha256:new');
        expect(refreshed.Labels).toEqual({ 'wud.watch': 'true' });
        expect(refreshed.Labels[COMPOSE_IMAGE_LABEL]).toBeUndefined();
    });

    test('leaves a config without labels untouched', () => {
        const config = containerSpec().Config;
        expect(refreshComposeImageLabel(config, 'sha256:new')).toBe(config);
    });

    test('returns the config unchanged when the new image id is undefined', () => {
        const config = containerSpec({
            Config: { Labels: { [COMPOSE_IMAGE_LABEL]: 'sha256:old' } },
        }).Config;
        expect(refreshComposeImageLabel(config, undefined)).toBe(config);
    });
});
