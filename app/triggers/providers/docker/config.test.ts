import type Dockerode from 'dockerode';
import {
    deriveUserConfig,
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

describe('deriveUserConfig Env', () => {
    test('keeps an entry whose key the image does not declare', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Env: ['APP_MODE=debug'] } }),
            imageConfig({ Env: ['PATH=/usr/bin'] }),
        );
        expect(derived.Env).toEqual(['APP_MODE=debug']);
    });

    test('drops an entry equal to the image default and keeps a differing one', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Env: ['PATH=/usr/bin', 'PUID=1000'] },
            }),
            imageConfig({ Env: ['PATH=/usr/bin', 'PUID=911'] }),
        );
        expect(derived.Env).toEqual(['PUID=1000']);
    });

    test('preserves the relative order of the kept entries', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Env: ['A=1', 'PATH=/usr/bin', 'B=2', 'C=3'] },
            }),
            imageConfig({ Env: ['PATH=/usr/bin'] }),
        );
        expect(derived.Env).toEqual(['A=1', 'B=2', 'C=3']);
    });

    test('compares an entry without an equals sign by its whole text', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Env: ['DEBUG', 'TRACE'] } }),
            imageConfig({ Env: ['DEBUG'] }),
        );
        expect(derived.Env).toEqual(['TRACE']);
    });

    test('splits on the first equals sign only', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Env: ['QUERY=a=b', 'OTHER=x=y'] },
            }),
            imageConfig({ Env: ['QUERY=a=b', 'OTHER=x=z'] }),
        );
        expect(derived.Env).toEqual(['OTHER=x=y']);
    });

    test('returns an empty array when every entry is inherited', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Env: ['PATH=/usr/bin'] } }),
            imageConfig({ Env: ['PATH=/usr/bin'] }),
        );
        expect(derived.Env).toEqual([]);
    });
});

describe('deriveUserConfig Labels', () => {
    test('drops image-equal labels and keeps the container-only and differing ones', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    Labels: {
                        maintainer: 'someone',
                        'org.opencontainers.image.version': '2.0.0',
                        'com.docker.compose.service': 'app',
                        'wud.tag.include': '^\\d+$',
                    },
                },
            }),
            imageConfig({
                Labels: {
                    maintainer: 'someone',
                    'org.opencontainers.image.version': '1.0.0',
                },
            }),
        );
        expect(derived.Labels).toEqual({
            'org.opencontainers.image.version': '2.0.0',
            'com.docker.compose.service': 'app',
            'wud.tag.include': '^\\d+$',
        });
    });

    test('returns an empty object when every label is inherited', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Labels: { maintainer: 'someone' } } }),
            imageConfig({ Labels: { maintainer: 'someone' } }),
        );
        expect(derived.Labels).toEqual({});
    });
});

describe('deriveUserConfig scalar fields', () => {
    test('blanks a value equal to the image default', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    User: 'app',
                    WorkingDir: '/home/app',
                    StopSignal: 'SIGTERM',
                },
            }),
            imageConfig({
                User: 'app',
                WorkingDir: '/home/app',
                StopSignal: 'SIGTERM',
            }),
        );
        expect(derived.User).toEqual('');
        expect(derived.WorkingDir).toEqual('');
        expect(derived.StopSignal).toEqual('');
    });

    test('keeps a value that differs from the image default', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    User: 'root',
                    WorkingDir: '/srv',
                    StopSignal: 'SIGINT',
                },
            }),
            imageConfig({
                User: 'app',
                WorkingDir: '/home/app',
                StopSignal: 'SIGTERM',
            }),
        );
        expect(derived.User).toEqual('root');
        expect(derived.WorkingDir).toEqual('/srv');
        expect(derived.StopSignal).toEqual('SIGINT');
    });

    test('blanks a value when both the container and the image are empty', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { User: '', WorkingDir: '' } }),
            imageConfig(),
        );
        expect(derived.User).toEqual('');
        expect(derived.WorkingDir).toEqual('');
        expect(derived.StopSignal).toEqual('');
    });
});

describe('deriveUserConfig ExposedPorts', () => {
    test('removes the image ports and keeps the container-only ones', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    ExposedPorts: { '80/tcp': {}, '9999/tcp': {} },
                },
            }),
            imageConfig({ ExposedPorts: { '80/tcp': {} } }),
        );
        expect(derived.ExposedPorts).toEqual({ '9999/tcp': {} });
    });

    test('keeps a published port even when the image declares it', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { ExposedPorts: { '80/tcp': {} } },
                HostConfig: {
                    PortBindings: { '80/tcp': [{ HostPort: '8080' }] },
                },
            }),
            imageConfig({ ExposedPorts: { '80/tcp': {} } }),
        );
        expect(derived.ExposedPorts).toEqual({ '80/tcp': {} });
    });

    test('is undefined when nothing is left', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { ExposedPorts: { '80/tcp': {} } } }),
            imageConfig({ ExposedPorts: { '80/tcp': {} } }),
        );
        expect(derived.ExposedPorts).toBeUndefined();
    });
});

describe('deriveUserConfig Volumes', () => {
    test('removes the image volumes and keeps the container-only ones', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Volumes: { '/data': {}, '/extra': {} } },
            }),
            imageConfig({ Volumes: { '/data': {} } }),
        );
        expect(derived.Volumes).toEqual({ '/extra': {} });
    });

    test('is undefined when nothing is left', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Volumes: { '/data': {} } } }),
            imageConfig({ Volumes: { '/data': {} } }),
        );
        expect(derived.Volumes).toBeUndefined();
    });
});

describe('deriveUserConfig Hostname', () => {
    test('blanks the container own short id', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Id: 'abcdef0123456789',
                Config: { Hostname: 'abcdef012345' },
            }),
            imageConfig(),
        );
        expect(derived.Hostname).toEqual('');
    });

    test('blanks an unrelated 12 hex digit hostname', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Hostname: '0123456789ab' } }),
            imageConfig(),
        );
        expect(derived.Hostname).toEqual('');
    });

    test('keeps a hostname that is not 12 lowercase hex digits', () => {
        const cases = [
            'my-host',
            'abcdef01234',
            'abcdef0123456',
            'ABCDEF012345',
        ];
        cases.forEach((hostname) => {
            const derived = deriveUserConfig(
                containerSpec({ Config: { Hostname: hostname } }),
                imageConfig(),
            );
            expect(derived.Hostname).toEqual(hostname);
        });
    });

    test('applies even when the image config is undefined', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Hostname: 'abcdef012345' } }),
            undefined,
        );
        expect(derived.Hostname).toEqual('');
    });
});

describe('deriveUserConfig without an image config', () => {
    test('copies every field but the hostname verbatim', () => {
        const current = containerSpec({
            Config: {
                Hostname: 'abcdef012345',
                User: 'app',
                WorkingDir: '/home/app',
                StopSignal: 'SIGTERM',
                Env: ['PATH=/usr/bin'],
                Labels: { maintainer: 'someone' },
                ExposedPorts: { '80/tcp': {} },
                Volumes: { '/data': {} },
                Cmd: ['./podinfo'],
            },
        });
        const derived = deriveUserConfig(current, undefined);
        expect(derived).toEqual({ ...current.Config, Hostname: '' });
    });
});

describe('deriveUserConfig hints', () => {
    test('keeps a hinted env key whose value equals the image default', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Env: ['PUID=1000', 'PATH=/usr/bin'] } }),
            imageConfig({ Env: ['PUID=1000', 'PATH=/usr/bin'] }),
            hints({ envKeys: ['PUID'] }),
        );
        expect(derived.Env).toEqual(['PUID=1000']);
    });

    test('keeps a hinted label whose value equals the image default', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    Labels: {
                        'org.opencontainers.image.version': '1.0.0',
                        maintainer: 'someone',
                    },
                },
            }),
            imageConfig({
                Labels: {
                    'org.opencontainers.image.version': '1.0.0',
                    maintainer: 'someone',
                },
            }),
            hints({ labelKeys: ['org.opencontainers.image.version'] }),
        );
        expect(derived.Labels).toEqual({
            'org.opencontainers.image.version': '1.0.0',
        });
    });

    test('keeps hinted scalar fields that equal the image default', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    Hostname: 'abcdef012345',
                    User: 'app',
                    WorkingDir: '/home/app',
                    StopSignal: 'SIGTERM',
                },
            }),
            imageConfig({
                User: 'app',
                WorkingDir: '/home/app',
                StopSignal: 'SIGTERM',
            }),
            hints({
                fields: ['Hostname', 'User', 'WorkingDir', 'StopSignal'],
            }),
        );
        expect(derived.Hostname).toEqual('abcdef012345');
        expect(derived.User).toEqual('app');
        expect(derived.WorkingDir).toEqual('/home/app');
        expect(derived.StopSignal).toEqual('SIGTERM');
    });

    test('keeps every exposed port when ExposedPorts is hinted', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { ExposedPorts: { '80/tcp': {}, '9999/tcp': {} } },
            }),
            imageConfig({ ExposedPorts: { '80/tcp': {} } }),
            hints({ fields: ['ExposedPorts'] }),
        );
        expect(derived.ExposedPorts).toEqual({
            '80/tcp': {},
            '9999/tcp': {},
        });
    });
});

describe('deriveUserConfig immutability', () => {
    test('does not mutate its inputs', () => {
        const current = containerSpec({
            Config: {
                Hostname: 'abcdef012345',
                User: 'app',
                WorkingDir: '/home/app',
                StopSignal: 'SIGTERM',
                Env: ['PATH=/usr/bin', 'PUID=1000'],
                Labels: { maintainer: 'someone', 'wud.watch': 'true' },
                ExposedPorts: { '80/tcp': {} },
                Volumes: { '/data': {} },
            },
            HostConfig: { PortBindings: { '80/tcp': [{ HostPort: '8080' }] } },
        });
        const image = imageConfig({
            User: 'app',
            WorkingDir: '/home/app',
            StopSignal: 'SIGTERM',
            Env: ['PATH=/usr/bin'],
            Labels: { maintainer: 'someone' },
            ExposedPorts: { '80/tcp': {} },
            Volumes: { '/data': {} },
        });
        const currentBefore = JSON.parse(JSON.stringify(current));
        const imageBefore = JSON.parse(JSON.stringify(image));
        deriveUserConfig(current, image, hints({ envKeys: ['NOPE'] }));
        expect(JSON.parse(JSON.stringify(current))).toEqual(currentBefore);
        expect(JSON.parse(JSON.stringify(image))).toEqual(imageBefore);
    });
});

describe('deriveUserConfig Entrypoint and Cmd', () => {
    test('drops both when both equal the image defaults', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Entrypoint: ['/init'], Cmd: ['./podinfo'] },
            }),
            imageConfig({ Entrypoint: ['/init'], Cmd: ['./podinfo'] }),
        );
        expect(derived.Entrypoint).toBeUndefined();
        expect(derived.Cmd).toBeUndefined();
    });

    test('keeps a differing command while dropping an inherited entrypoint', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Entrypoint: ['/init'], Cmd: ['--serve'] },
            }),
            imageConfig({ Entrypoint: ['/init'], Cmd: ['./podinfo'] }),
        );
        expect(derived.Entrypoint).toBeUndefined();
        expect(derived.Cmd).toEqual(['--serve']);
    });

    test('keeps both when the entrypoint was overridden, including a null command', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Entrypoint: ['/bin/sh'], Cmd: null },
            }),
            imageConfig({ Entrypoint: ['/init'], Cmd: ['./podinfo'] }),
        );
        expect(derived.Entrypoint).toEqual(['/bin/sh']);
        expect(derived.Cmd).toBeNull();
    });

    test('treats null, an empty array and an empty string as equal', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Entrypoint: '', Cmd: [] } }),
            imageConfig({ Entrypoint: null, Cmd: null }),
        );
        expect(derived.Entrypoint).toBeUndefined();
        expect(derived.Cmd).toBeUndefined();
    });

    test('drops a string entrypoint equal to the image single element array', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Entrypoint: '/init' } }),
            imageConfig({ Entrypoint: ['/init'] }),
        );
        expect(derived.Entrypoint).toBeUndefined();
    });
});

describe('deriveUserConfig Healthcheck', () => {
    const containerHealthcheck = {
        Test: ['CMD', 'curl', '-f', 'http://localhost'],
        Interval: 30,
        Timeout: 5,
        StartPeriod: 2,
        StartInterval: 0,
        Retries: 3,
    };

    test('drops a healthcheck fully equal to the image one', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Healthcheck: containerHealthcheck } }),
            imageConfig({ Healthcheck: { ...containerHealthcheck } }),
        );
        expect(derived.Healthcheck).toBeUndefined();
    });

    test('zeroes the inherited fields and keeps the differing one', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    Healthcheck: { ...containerHealthcheck, Interval: 60 },
                },
            }),
            imageConfig({ Healthcheck: { ...containerHealthcheck } }),
        );
        expect(derived.Healthcheck).toEqual({
            Test: [],
            Interval: 60,
            Timeout: 0,
            StartPeriod: 0,
            StartInterval: 0,
            Retries: 0,
        });
    });

    test('keeps the healthcheck verbatim when the image declares none', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Healthcheck: containerHealthcheck } }),
            imageConfig(),
        );
        expect(derived.Healthcheck).toEqual(containerHealthcheck);
    });

    test('keeps a disabled healthcheck', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Healthcheck: { Test: ['NONE'] } } }),
            imageConfig({ Healthcheck: { ...containerHealthcheck } }),
        );
        expect(derived.Healthcheck.Test).toEqual(['NONE']);
    });

    test('treats a missing numeric field as equal to zero', () => {
        const { StartInterval, ...withoutStartInterval } = containerHealthcheck;
        expect(StartInterval).toEqual(0);
        const derived = deriveUserConfig(
            containerSpec({ Config: { Healthcheck: withoutStartInterval } }),
            imageConfig({ Healthcheck: { ...containerHealthcheck } }),
        );
        expect(derived.Healthcheck).toBeUndefined();
    });
});

describe('deriveUserConfig Entrypoint, Cmd and Healthcheck hints', () => {
    const containerHealthcheck = {
        Test: ['CMD', 'curl', '-f', 'http://localhost'],
        Interval: 30,
        Timeout: 5,
        StartPeriod: 2,
        StartInterval: 0,
        Retries: 3,
    };

    test('a hinted Cmd is kept while an inherited entrypoint still drops', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Entrypoint: ['/init'], Cmd: ['./podinfo'] },
            }),
            imageConfig({ Entrypoint: ['/init'], Cmd: ['./podinfo'] }),
            hints({ fields: ['Cmd'] }),
        );
        expect(derived.Entrypoint).toBeUndefined();
        expect(derived.Cmd).toEqual(['./podinfo']);
    });

    test('a hinted Entrypoint keeps both the entrypoint and the command', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: { Entrypoint: ['/init'], Cmd: ['./podinfo'] },
            }),
            imageConfig({ Entrypoint: ['/init'], Cmd: ['./podinfo'] }),
            hints({ fields: ['Entrypoint'] }),
        );
        expect(derived.Entrypoint).toEqual(['/init']);
        expect(derived.Cmd).toEqual(['./podinfo']);
    });

    test('a hinted healthcheck field is not zeroed while the others are', () => {
        const derived = deriveUserConfig(
            containerSpec({
                Config: {
                    Healthcheck: { ...containerHealthcheck, Interval: 60 },
                },
            }),
            imageConfig({ Healthcheck: { ...containerHealthcheck } }),
            hints({ healthcheck: ['Timeout'] }),
        );
        expect(derived.Healthcheck).toEqual({
            Test: [],
            Interval: 60,
            Timeout: 5,
            StartPeriod: 0,
            StartInterval: 0,
            Retries: 0,
        });
    });

    test('an all equal healthcheck with one hinted field is not collapsed', () => {
        const derived = deriveUserConfig(
            containerSpec({ Config: { Healthcheck: containerHealthcheck } }),
            imageConfig({ Healthcheck: { ...containerHealthcheck } }),
            hints({ healthcheck: ['Interval'] }),
        );
        expect(derived.Healthcheck).toEqual({
            Test: [],
            Interval: 30,
            Timeout: 0,
            StartPeriod: 0,
            StartInterval: 0,
            Retries: 0,
        });
    });

    test('does not mutate the entrypoint, command or healthcheck inputs', () => {
        const current = containerSpec({
            Config: {
                Entrypoint: ['/init'],
                Cmd: ['./podinfo'],
                Healthcheck: { ...containerHealthcheck, Interval: 60 },
            },
        });
        const image = imageConfig({
            Entrypoint: ['/init'],
            Cmd: ['./podinfo'],
            Healthcheck: { ...containerHealthcheck },
        });
        const currentBefore = JSON.parse(JSON.stringify(current));
        const imageBefore = JSON.parse(JSON.stringify(image));
        deriveUserConfig(current, image, hints({ healthcheck: ['Timeout'] }));
        expect(JSON.parse(JSON.stringify(current))).toEqual(currentBefore);
        expect(JSON.parse(JSON.stringify(image))).toEqual(imageBefore);
    });
});
