// @ts-nocheck
import * as container from './container';

test('model should be validated when compliant', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',

        linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: '1.0.0',
                semver: true,
            },
            digest: {
                watch: false,
                repo: undefined,
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: '2.0.0',
        },
    });

    expect(containerValidated.resultChanged.name).toEqual(
        'resultChangedFunction',
    );
    delete containerValidated.resultChanged;

    expect(containerValidated).toStrictEqual({
        id: 'container-123456789',
        status: 'unknown',
        image: {
            architecture: 'arch',
            created: '2021-06-12T05:33:38.440Z',
            digest: {
                watch: false,
                repo: undefined,
            },
            id: 'image-123456789',
            name: 'organization/image',
            os: 'os',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            tag: {
                semver: true,
                value: '1.0.0',
            },
        },
        name: 'test',
        displayName: 'test',
        displayIcon: 'mdi:docker',

        linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
        link: 'https://release-1.0.0.acme.com',
        updateAvailable: true,
        updateKind: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
            semverDiff: 'major',
        },
        result: {
            link: 'https://release-2.0.0.acme.com',
            tag: '2.0.0',
        },
        watcher: 'test',
    });
});

test('model should not be validated when invalid', async () => {
    expect(() => {
        container.validate({});
    }).toThrow();
});

test('model should flag updateAvailable when tag is different', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: 'x',
                semver: false,
            },
            digest: {
                watch: false,
                repo: undefined,
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: 'y',
        },
    });
    expect(containerValidated.updateAvailable).toBeTruthy();
});

test('model should not flag updateAvailable when tag is equal', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: 'x',
                semver: false,
            },
            digest: {
                watch: false,
                repo: undefined,
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: 'x',
        },
    });
    expect(containerValidated.updateAvailable).toBeFalsy();
});

test('model should flag updateAvailable when digest is different', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: 'x',
                semver: false,
            },
            digest: {
                watch: true,
                repo: 'x',
                value: 'x',
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: 'x',
            digest: 'y',
        },
    });
    expect(containerValidated.updateAvailable).toBeTruthy();
});

test('model should flag updateAvailable when created is different', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: 'x',
                semver: false,
            },
            digest: {
                watch: true,
                repo: 'x',
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: 'x',
            created: '2021-06-15T05:33:38.440Z',
        },
    });
    const containerEquals = container.validate({
        ...containerValidated,
    });
    const containerDifferent = container.validate({
        ...containerValidated,
    });
    containerDifferent.result.tag = 'y';
    expect(containerValidated.resultChanged(containerEquals)).toBeFalsy();
    expect(containerValidated.resultChanged(containerDifferent)).toBeTruthy();
});

test('model should support transforms for links', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',
        transformTags: '^(\\d+\\.\\d+)-.*-(\\d+) => $1.$2',

        linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: '1.2-foo-3',
                semver: true,
            },
            digest: {},
            architecture: 'arch',
            os: 'os',
        },
        result: {
            tag: '1.2-bar-4',
        },
    });

    expect(containerValidated).toMatchObject({
        link: 'https://release-1.2.3.acme.com',
        result: {
            link: 'https://release-1.2.4.acme.com',
        },
    });
});

test('flatten should be flatten the nested properties with underscores when called', async () => {
    const containerValidated = container.validate({
        id: 'container-123456789',
        name: 'test',
        watcher: 'test',

        linkTemplate: 'https://release-${major}.${minor}.${patch}.acme.com',
        image: {
            id: 'image-123456789',
            registry: {
                name: 'hub',
                url: 'https://hub',
            },
            name: 'organization/image',
            tag: {
                value: '1.0.0',
                semver: true,
            },
            digest: {
                watch: false,
                repo: undefined,
            },
            architecture: 'arch',
            os: 'os',
            created: '2021-06-12T05:33:38.440Z',
        },
        result: {
            tag: '2.0.0',
        },
    });

    expect(container.flatten(containerValidated)).toEqual({
        id: 'container-123456789',
        status: 'unknown',
        image_architecture: 'arch',
        image_created: '2021-06-12T05:33:38.440Z',
        image_digest_watch: false,
        image_id: 'image-123456789',
        image_name: 'organization/image',
        image_os: 'os',
        image_registry_name: 'hub',
        image_registry_url: 'https://hub',
        image_tag_semver: true,
        image_tag_value: '1.0.0',
        link: 'https://release-1.0.0.acme.com',

        link_template: 'https://release-${major}.${minor}.${patch}.acme.com',
        name: 'test',
        display_name: 'test',
        display_icon: 'mdi:docker',
        result_link: 'https://release-2.0.0.acme.com',
        result_tag: '2.0.0',
        update_available: true,
        update_kind_kind: 'tag',
        update_kind_local_value: '1.0.0',
        update_kind_remote_value: '2.0.0',
        update_kind_semver_diff: 'major',
        watcher: 'test',
    });
});

const containerWithUpdates = (extra = {}) => ({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
        id: 'image-123456789',
        registry: {
            name: 'hub',
            url: 'https://hub',
        },
        name: 'organization/image',
        tag: {
            value: '1.0.0',
            semver: true,
        },
        digest: {
            watch: false,
            repo: undefined,
        },
        architecture: 'arch',
        os: 'os',
        created: '2021-06-12T05:33:38.440Z',
    },
    result: {
        tag: '2.0.0',
    },
    ...extra,
});

test('model should validate updates mixing object buckets, null buckets and absent keys', async () => {
    const updates = {
        major: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
            semverDiff: 'major',
            link: 'https://release-2.0.0.acme.com',
        },
        minor: null,
        patch: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '1.0.1',
            semverDiff: 'patch',
        },
    };
    const containerValidated = container.validate(
        containerWithUpdates({ updates }),
    );

    expect(containerValidated.updates).toStrictEqual(updates);
    expect('major' in containerValidated.updates).toBe(true);
    expect('minor' in containerValidated.updates).toBe(true);
    expect('patch' in containerValidated.updates).toBe(true);
    expect('digest' in containerValidated.updates).toBe(false);
});

test('model should validate a digest bucket with a created date', async () => {
    const updates = {
        digest: {
            kind: 'digest',
            localValue: 'sha256:123456789',
            remoteValue: 'sha256:987654321',
            created: '2021-06-15T05:33:38.440Z',
        },
    };
    const containerValidated = container.validate(
        containerWithUpdates({ updates }),
    );
    expect(containerValidated.updates).toStrictEqual(updates);
});

test('model should not synthesise updates when the stored record has none', async () => {
    const containerValidated = container.validate(containerWithUpdates());
    expect('updates' in containerValidated).toBe(false);
    expect(containerValidated.updates).toBeUndefined();
});

test('model should validate a container carrying a dynamic ceiling', async () => {
    const ceiling = { tag: 'stable', version: '2.37.9' };
    const containerValidated = container.validate(
        containerWithUpdates({ ceiling }),
    );
    expect(containerValidated.ceiling).toStrictEqual(ceiling);
});

test('model should validate a container carrying a static ceiling', async () => {
    const ceiling = { version: '2.1' };
    const containerValidated = container.validate(
        containerWithUpdates({ ceiling }),
    );
    expect(containerValidated.ceiling).toStrictEqual(ceiling);
});

test('model should reject a ceiling without a version', async () => {
    expect(() => {
        container.validate(
            containerWithUpdates({ ceiling: { tag: 'stable' } }),
        );
    }).toThrow();
});

test('flatten should emit ceiling_tag and ceiling_version when called', async () => {
    const containerValidated = container.validate(
        containerWithUpdates({ ceiling: { tag: 'stable', version: '2.37.9' } }),
    );
    const containerFlatten = container.flatten(containerValidated);
    expect(containerFlatten.ceiling_tag).toEqual('stable');
    expect(containerFlatten.ceiling_version).toEqual('2.37.9');
});

test('model should validate a selectedUpdate', async () => {
    const selectedUpdate = {
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '1.0.1',
        semverDiff: 'patch',
    };
    const containerValidated = container.validate(
        containerWithUpdates({ selectedUpdate }),
    );
    expect(containerValidated.selectedUpdate).toStrictEqual(selectedUpdate);
});

test('model should reject an update bucket without a kind', async () => {
    expect(() => {
        container.validate(
            containerWithUpdates({
                updates: { major: { localValue: '1.0.0' } },
            }),
        );
    }).toThrow();
});

test('resultChanged should be true when only a non-winning bucket differs', async () => {
    const base = {
        major: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
            semverDiff: 'major',
        },
        patch: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '1.0.1',
            semverDiff: 'patch',
        },
    };
    const containerValidated = container.validate(
        containerWithUpdates({ updates: base }),
    );
    const containerOtherPatch = container.validate(
        containerWithUpdates({
            updates: {
                ...base,
                patch: { ...base.patch, remoteValue: '1.0.2' },
            },
        }),
    );

    expect(containerValidated.result).toStrictEqual(containerOtherPatch.result);
    expect(containerValidated.resultChanged(containerOtherPatch)).toBe(true);
});

test('resultChanged should distinguish an absent bucket from a null bucket', async () => {
    const containerWithNullBucket = container.validate(
        containerWithUpdates({ updates: { major: null } }),
    );
    const containerWithoutBucket = container.validate(
        containerWithUpdates({ updates: {} }),
    );
    expect(containerWithNullBucket.resultChanged(containerWithoutBucket)).toBe(
        true,
    );
    expect(containerWithoutBucket.resultChanged(containerWithNullBucket)).toBe(
        true,
    );
});

test('resultChanged should be false when result and updates are identical', async () => {
    const updates = {
        major: {
            kind: 'tag',
            localValue: '1.0.0',
            remoteValue: '2.0.0',
            semverDiff: 'major',
        },
        minor: null,
    };
    const containerValidated = container.validate(
        containerWithUpdates({ updates }),
    );
    const containerEquals = container.validate(
        containerWithUpdates({ updates: { ...updates } }),
    );
    expect(containerValidated.resultChanged(containerEquals)).toBe(false);
});

test('resultChanged should be false for two legacy containers without updates', async () => {
    const containerValidated = container.validate(containerWithUpdates());
    const containerEquals = container.validate(containerWithUpdates());
    expect('updates' in containerValidated).toBe(false);
    expect('updates' in containerEquals).toBe(false);
    expect(containerValidated.resultChanged(containerEquals)).toBe(false);
});

const nonSemverDigestContainer = (imageDigest, resultDigest) => ({
    id: 'container-123456789',
    name: 'test',
    watcher: 'test',
    image: {
        id: 'image-123456789',
        registry: { name: 'hub', url: 'https://hub' },
        name: 'organization/image',
        tag: { value: 'x', semver: false },
        digest: { watch: true, repo: 'x', value: imageDigest },
        architecture: 'arch',
        os: 'os',
    },
    result: { tag: 'x', digest: resultDigest },
});

test('updateAvailable should stay true for a non semver container with a different digest', async () => {
    const containerValidated = container.validate(
        nonSemverDigestContainer('sha256:1', 'sha256:2'),
    );
    expect(containerValidated.updateAvailable).toBe(true);
});

test('updateAvailable should stay false for a non semver container with an equal digest', async () => {
    const containerValidated = container.validate(
        nonSemverDigestContainer('sha256:1', 'sha256:1'),
    );
    expect(containerValidated.updateAvailable).toBe(false);
});

test('updateAvailable should still compare tags for a semver container without digest watch', async () => {
    expect(container.validate(containerWithUpdates()).updateAvailable).toBe(
        true,
    );
    expect(
        container.validate(containerWithUpdates({ result: { tag: '1.0.0' } }))
            .updateAvailable,
    ).toBe(false);
});

test('updateAvailable should be false when there is no result', async () => {
    const withoutResult = containerWithUpdates();
    delete withoutResult.result;
    expect(container.validate(withoutResult).updateAvailable).toBe(false);
});

test('updateAvailable should be true for a semver container with an equal digest but a different tag', async () => {
    const containerValidated = container.validate(
        containerWithUpdates({
            image: {
                id: 'image-123456789',
                registry: { name: 'hub', url: 'https://hub' },
                name: 'organization/image',
                tag: { value: '1.0.0', semver: true },
                digest: { watch: true, repo: 'x', value: 'sha256:1' },
                architecture: 'arch',
                os: 'os',
            },
            result: { tag: '2.0.0', digest: 'sha256:1' },
        }),
    );
    expect(containerValidated.updateAvailable).toBe(true);
});

test('updateAvailable should be false for a semver container with an equal digest, an equal tag and a different created date', async () => {
    const containerValidated = container.validate(
        containerWithUpdates({
            image: {
                id: 'image-123456789',
                registry: { name: 'hub', url: 'https://hub' },
                name: 'organization/image',
                tag: { value: '1.0.0', semver: true },
                digest: { watch: true, repo: 'x', value: 'sha256:1' },
                architecture: 'arch',
                os: 'os',
                created: '2021-06-12T05:33:38.440Z',
            },
            result: {
                tag: '1.0.0',
                digest: 'sha256:1',
                created: '2021-06-15T05:33:38.440Z',
            },
        }),
    );
    expect(containerValidated.updateAvailable).toBe(false);
});

test('updateAvailable should keep the created date fallback when the digest is unresolved', async () => {
    const containerValidated = container.validate(
        containerWithUpdates({
            image: {
                id: 'image-123456789',
                registry: { name: 'hub', url: 'https://hub' },
                name: 'organization/image',
                tag: { value: '1.0.0', semver: true },
                digest: { watch: true, repo: 'x' },
                architecture: 'arch',
                os: 'os',
                created: '2021-06-12T05:33:38.440Z',
            },
            result: {
                tag: '1.0.0',
                created: '2021-06-15T05:33:38.440Z',
            },
        }),
    );
    expect(containerValidated.updateAvailable).toBe(true);
});

test('renderLink should render link templates for an arbitrary tag value', async () => {
    expect(
        container.renderLink(
            {
                linkTemplate:
                    'https://test-${major}.${minor}.${patch}.acme.com',
                image: {
                    tag: {
                        semver: true,
                    },
                },
            },
            '10.5.2',
        ),
    ).toEqual('https://test-10.5.2.acme.com');
});

test('renderLink should render undefined when template is missing', async () => {
    expect(
        container.renderLink(
            {
                image: {
                    tag: {
                        semver: true,
                    },
                },
            },
            '10.5.2',
        ),
    ).toBeUndefined();
});

test('fullName should build an id with watcher name & container name when called', async () => {
    expect(
        container.fullName({
            watcher: 'watcher',
            name: 'container_name',
        }),
    ).toEqual('watcher_container_name');
});

test('getLink should render link templates when called', async () => {
    const { testable_getLink: getLink } = container;
    expect(
        getLink(
            {
                linkTemplate:
                    'https://test-${major}.${minor}.${patch}.acme.com',
                image: {
                    tag: {
                        semver: true,
                    },
                },
            },
            '10.5.2',
        ),
    ).toEqual('https://test-10.5.2.acme.com');
});

test('getLink should render undefined when template is missing', async () => {
    const { testable_getLink: getLink } = container;
    expect(getLink(undefined)).toBeUndefined();
});

test('addUpdateKindProperty should detect major update', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        updateAvailable: true,
        image: {
            tag: {
                value: '1.0.0',
                semver: true,
            },
        },
        result: {
            tag: '2.0.0',
        },
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '2.0.0',
        semverDiff: 'major',
    });
});

test('addUpdateKindProperty should detect minor update', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        updateAvailable: true,
        image: {
            tag: {
                value: '1.0.0',
                semver: true,
            },
        },
        result: {
            tag: '1.1.0',
        },
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '1.1.0',
        semverDiff: 'minor',
    });
});

test('addUpdateKindProperty should detect patch update', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        updateAvailable: true,
        image: {
            tag: {
                value: '1.0.0',
                semver: true,
            },
        },
        result: {
            tag: '1.0.1',
        },
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'tag',
        localValue: '1.0.0',
        remoteValue: '1.0.1',
        semverDiff: 'patch',
    });
});

test('addUpdateKindProperty should support transforms', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        transformTags: '^(\\d+\\.\\d+)-.*-(\\d+) => $1.$2',
        updateAvailable: true,
        image: {
            tag: {
                value: '1.2-foo-3',
                semver: true,
            },
        },
        result: {
            tag: '1.2-bar-4',
        },
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'tag',
        localValue: '1.2-foo-3',
        remoteValue: '1.2-bar-4',
        semverDiff: 'patch',
    });
});

test('addUpdateKindProperty should detect prerelease semver update', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        updateAvailable: true,
        image: {
            tag: {
                value: '1.0.0-test1',
                semver: true,
            },
        },
        result: {
            tag: '1.0.0-test2',
        },
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'tag',
        localValue: '1.0.0-test1',
        remoteValue: '1.0.0-test2',
        semverDiff: 'prerelease',
    });
});

test('addUpdateKindProperty should detect digest update', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        updateAvailable: true,
        image: {
            tag: {
                value: 'latest',
                semver: false,
            },
            digest: {
                value: 'sha256:123465789',
            },
        },
        result: {
            tag: 'latest',
            digest: 'sha256:987654321',
        },
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'digest',
        localValue: 'sha256:123465789',
        remoteValue: 'sha256:987654321',
    });
});

test('addUpdateKindProperty should return unknown when no image or result', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {};
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'unknown',
    });
});

test('addUpdateKindProperty should return unknown when no update available', async () => {
    const { testable_addUpdateKindProperty: addUpdateKindProperty } = container;
    const containerObject = {
        image: 'image',
        result: {},
        updateAvailable: false,
    };
    addUpdateKindProperty(containerObject);
    expect(containerObject.updateKind).toEqual({
        kind: 'unknown',
    });
});
