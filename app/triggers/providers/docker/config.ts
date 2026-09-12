import type Dockerode from 'dockerode';

/** @types/dockerode 3.3.47 declares no StopSignal on either config; the intersection is the whole fix. */
export type ContainerConfig = Dockerode.ContainerInspectInfo['Config'] & {
    StopSignal?: string;
};

export type ImageConfig = Dockerode.ImageInspectInfo['Config'] & {
    StopSignal?: string;
};

export const COMPOSE_IMAGE_LABEL = 'com.docker.compose.image';

/** Config fields a hint can pin as user-set, named as the daemon names them. */
export type HintedField =
    | 'Hostname'
    | 'User'
    | 'WorkingDir'
    | 'StopSignal'
    | 'Cmd'
    | 'Entrypoint'
    | 'ExposedPorts';

export type HintedHealthcheckField =
    | 'Test'
    | 'Interval'
    | 'Timeout'
    | 'StartPeriod'
    | 'StartInterval'
    | 'Retries';

/**
 * Keys known to be set on the container by the user (from a compose file), which
 * must be carried over even when they equal the old image's default.
 */
export interface UserConfigHints {
    envKeys: ReadonlySet<string>;
    labelKeys: ReadonlySet<string>;
    fields: ReadonlySet<HintedField>;
    healthcheck: ReadonlySet<HintedHealthcheckField>;
}

export function emptyHints(): UserConfigHints {
    return {
        envKeys: new Set<string>(),
        labelKeys: new Set<string>(),
        fields: new Set<HintedField>(),
        healthcheck: new Set<HintedHealthcheckField>(),
    };
}

export function mergeHints(...hints: UserConfigHints[]): UserConfigHints {
    const envKeys = new Set<string>();
    const labelKeys = new Set<string>();
    const fields = new Set<HintedField>();
    const healthcheck = new Set<HintedHealthcheckField>();
    hints.forEach((hint) => {
        hint.envKeys.forEach((key) => envKeys.add(key));
        hint.labelKeys.forEach((key) => labelKeys.add(key));
        hint.fields.forEach((field) => fields.add(field));
        hint.healthcheck.forEach((field) => healthcheck.add(field));
    });
    return { envKeys, labelKeys, fields, healthcheck };
}

/** Point com.docker.compose.image at the image the container will run, only if the label is present. */
export function refreshComposeImageLabel(
    config: ContainerConfig,
    newImageId: string | undefined,
): ContainerConfig {
    if (
        newImageId === undefined ||
        config.Labels?.[COMPOSE_IMAGE_LABEL] === undefined
    ) {
        return config;
    }
    return {
        ...config,
        Labels: { ...config.Labels, [COMPOSE_IMAGE_LABEL]: newImageId },
    };
}

type PortMap = ContainerConfig['ExposedPorts'];
type VolumeMap = ContainerConfig['Volumes'];
type HealthcheckConfig = ContainerConfig['Healthcheck'];

const GENERATED_HOSTNAME = /^[0-9a-f]{12}$/;

function splitEnv(entry: string): [string, string] {
    const separator = entry.indexOf('=');
    return separator === -1
        ? [entry, entry]
        : [entry.slice(0, separator), entry.slice(separator + 1)];
}

function deriveScalar(
    value: string | undefined,
    imageValue: string | undefined,
    hinted: boolean,
): string | undefined {
    if (hinted) {
        return value;
    }
    return (value ?? '') === (imageValue ?? '') ? '' : value;
}

function deriveHostname(hostname: string, hinted: boolean): string {
    if (hinted) {
        return hostname;
    }
    return GENERATED_HOSTNAME.test(hostname ?? '') ? '' : hostname;
}

function deriveEnv(
    env: string[] | undefined,
    imageEnvEntries: string[] | undefined,
    hintedKeys: ReadonlySet<string>,
): string[] {
    const imageEnv = new Map<string, string>(
        (imageEnvEntries ?? []).map(splitEnv),
    );
    return (env ?? []).filter((entry) => {
        const [key, value] = splitEnv(entry);
        return (
            hintedKeys.has(key) ||
            !imageEnv.has(key) ||
            imageEnv.get(key) !== value
        );
    });
}

function deriveLabels(
    labels: Record<string, string> | undefined,
    imageLabels: Record<string, string> | undefined,
    hintedKeys: ReadonlySet<string>,
): Record<string, string> {
    const fromImage = imageLabels ?? {};
    const derived: Record<string, string> = {};
    Object.entries(labels ?? {}).forEach(([key, value]) => {
        if (
            hintedKeys.has(key) ||
            !(key in fromImage) ||
            fromImage[key] !== value
        ) {
            derived[key] = value;
        }
    });
    return derived;
}

function deriveExposedPorts(
    ports: PortMap | undefined,
    imagePorts: PortMap | undefined,
    publishedPorts: Record<string, unknown> | undefined,
): PortMap | undefined {
    const fromImage = imagePorts ?? {};
    const derived: PortMap = {};
    Object.entries(ports ?? {}).forEach(([port, value]) => {
        if (!(port in fromImage)) {
            derived[port] = value;
        }
    });
    Object.keys(publishedPorts ?? {}).forEach((port) => {
        if (!(port in derived)) {
            derived[port] = ports?.[port] ?? {};
        }
    });
    return Object.keys(derived).length > 0 ? derived : undefined;
}

function deriveVolumes(
    volumes: VolumeMap | undefined,
    imageVolumes: VolumeMap | undefined,
): VolumeMap | undefined {
    const fromImage = imageVolumes ?? {};
    const derived: VolumeMap = {};
    Object.entries(volumes ?? {}).forEach(([volume, value]) => {
        if (!(volume in fromImage)) {
            derived[volume] = value;
        }
    });
    return Object.keys(derived).length > 0 ? derived : undefined;
}

function normalizeArgv(argv: string | string[] | undefined): string[] {
    if (argv === undefined || argv === null || argv === '') {
        return [];
    }
    return typeof argv === 'string' ? [argv] : argv;
}

function argvEquals(left: string[], right: string[]): boolean {
    return (
        left.length === right.length &&
        left.every((item, index) => item === right[index])
    );
}

const HEALTHCHECK_FIELDS: HintedHealthcheckField[] = [
    'Test',
    'Interval',
    'Timeout',
    'StartPeriod',
    'StartInterval',
    'Retries',
];

function healthcheckFieldEquals(
    field: HintedHealthcheckField,
    healthcheck: HealthcheckConfig,
    imageHealthcheck: HealthcheckConfig,
): boolean {
    if (field === 'Test') {
        return argvEquals(
            healthcheck?.Test ?? [],
            imageHealthcheck?.Test ?? [],
        );
    }
    return (healthcheck?.[field] ?? 0) === (imageHealthcheck?.[field] ?? 0);
}

function deriveHealthcheck(
    healthcheck: HealthcheckConfig | undefined,
    imageHealthcheck: HealthcheckConfig | undefined,
    hintedFields: ReadonlySet<HintedHealthcheckField>,
): HealthcheckConfig | undefined {
    if (
        imageHealthcheck === undefined ||
        imageHealthcheck === null ||
        healthcheck === undefined ||
        healthcheck === null
    ) {
        return healthcheck;
    }
    const inherited = HEALTHCHECK_FIELDS.filter((field) =>
        healthcheckFieldEquals(field, healthcheck, imageHealthcheck),
    );
    if (
        inherited.length === HEALTHCHECK_FIELDS.length &&
        hintedFields.size === 0
    ) {
        return undefined;
    }
    const derived: HealthcheckConfig = { ...healthcheck };
    inherited
        .filter((field) => !hintedFields.has(field))
        .forEach((field) => {
            if (field === 'Test') {
                derived.Test = [];
            } else {
                derived[field] = 0;
            }
        });
    return derived;
}

/**
 * Recover the config the container was created with, by removing every value the
 * daemon merged in from the image it runs. A value equal to the image's is treated
 * as inherited unless a hint names its key.
 */
export function deriveUserConfig(
    current: Dockerode.ContainerInspectInfo,
    imageConfig: ImageConfig | undefined,
    hints: UserConfigHints = emptyHints(),
): ContainerConfig {
    const containerConfig: ContainerConfig =
        current.Config ?? ({} as ContainerConfig);
    const derived: ContainerConfig = { ...containerConfig };

    derived.Hostname = deriveHostname(
        containerConfig.Hostname,
        hints.fields.has('Hostname'),
    );

    if (imageConfig === undefined) {
        return derived;
    }

    derived.User = deriveScalar(
        containerConfig.User,
        imageConfig.User,
        hints.fields.has('User'),
    );
    derived.WorkingDir = deriveScalar(
        containerConfig.WorkingDir,
        imageConfig.WorkingDir,
        hints.fields.has('WorkingDir'),
    );
    derived.StopSignal = deriveScalar(
        containerConfig.StopSignal,
        imageConfig.StopSignal,
        hints.fields.has('StopSignal'),
    );
    derived.Env = deriveEnv(
        containerConfig.Env,
        imageConfig.Env,
        hints.envKeys,
    );
    derived.Labels = deriveLabels(
        containerConfig.Labels,
        imageConfig.Labels,
        hints.labelKeys,
    );
    if (!hints.fields.has('ExposedPorts')) {
        derived.ExposedPorts = deriveExposedPorts(
            containerConfig.ExposedPorts,
            imageConfig.ExposedPorts,
            current.HostConfig?.PortBindings,
        );
    }
    derived.Volumes = deriveVolumes(
        containerConfig.Volumes,
        imageConfig.Volumes,
    );

    if (
        !hints.fields.has('Entrypoint') &&
        argvEquals(
            normalizeArgv(containerConfig.Entrypoint),
            normalizeArgv(imageConfig.Entrypoint),
        )
    ) {
        derived.Entrypoint = undefined;
        if (
            !hints.fields.has('Cmd') &&
            argvEquals(
                normalizeArgv(containerConfig.Cmd),
                normalizeArgv(imageConfig.Cmd),
            )
        ) {
            derived.Cmd = undefined;
        }
    }

    derived.Healthcheck = deriveHealthcheck(
        containerConfig.Healthcheck,
        imageConfig.Healthcheck,
        hints.healthcheck,
    );

    return derived;
}
