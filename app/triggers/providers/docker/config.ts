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
