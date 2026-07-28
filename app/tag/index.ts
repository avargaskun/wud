/**
 * Semver utils.
 */
import semver from 'semver';
import log from '../log';

/**
 * Parse a string to a semver (return null is it cannot be parsed as a valid semver).
 * @param rawVersion
 * @returns {*|SemVer}
 */
export function parse(rawVersion: string): semver.SemVer | null {
    const rawVersionCleaned = semver.clean(rawVersion, { loose: true });
    const rawVersionSemver = semver.parse(
        rawVersionCleaned !== null ? rawVersionCleaned : rawVersion,
    );
    // Hurrah!
    if (rawVersionSemver !== null) {
        return rawVersionSemver;
    }

    // Last chance; try to coerce (all data behind patch digit will be lost).
    return semver.coerce(rawVersion);
}

/**
 * Return true if version1 is semver greater than version2.
 * Implemented with semver.gte: it also returns true for EQUAL versions.
 * @param version1
 * @param version2
 */
export function isGreater(version1: string, version2: string): boolean {
    const version1Semver = parse(version1);
    const version2Semver = parse(version2);

    // No comparison possible
    if (version1Semver === null || version2Semver === null) {
        return false;
    }
    return semver.gte(version1Semver, version2Semver);
}

/**
 * Diff between 2 semver versions.
 * @param version1
 * @param version2
 * @returns {*|string|null}
 */
export function diff(
    version1: string,
    version2: string,
): semver.ReleaseType | null {
    const version1Semver = parse(version1);
    const version2Semver = parse(version2);

    // No diff possible
    if (version1Semver === null || version2Semver === null) {
        return null;
    }
    return semver.diff(version1Semver, version2Semver);
}

/**
 * Transform a tag using a formula.
 * @param transformFormula
 * @param originalTag
 * @return {*}
 */
export function transform(
    transformFormula: string | undefined,
    originalTag: string,
): string {
    // No formula ? return original tag value
    if (!transformFormula || transformFormula === '') {
        return originalTag;
    }
    try {
        const transformFormulaSplit = transformFormula.split(/\s*=>\s*/);
        const transformRegex = new RegExp(transformFormulaSplit[0]);
        const placeholders = transformFormulaSplit[1].match(/\$\d+/g);
        const originalTagMatches = originalTag.match(transformRegex);

        let transformedTag = transformFormulaSplit[1];
        placeholders.forEach((placeholder) => {
            const placeholderIndex = Number.parseInt(
                placeholder.substring(1),
                10,
            );
            transformedTag = transformedTag.replace(
                new RegExp(placeholder.replace('$', '\\$'), 'g'),
                originalTagMatches[placeholderIndex],
            );
        });
        return transformedTag;
    } catch (e) {
        // Upon error; log & fallback to original tag value
        log.warn(
            `Error when applying transform function [${transformFormula}]to tag [${originalTag}]`,
        );
        log.debug(e);
        return originalTag;
    }
}

/**
 * Strict 3-way comparison between 2 versions.
 * Returns a negative number when version1 < version2, 0 when equal,
 * a positive number when version1 > version2, and null when either side
 * cannot be parsed as a semver.
 * @param version1
 * @param version2
 */
export function compare(version1: string, version2: string): number | null {
    const v1 = parse(version1);
    const v2 = parse(version2);
    if (v1 === null || v2 === null) {
        return null;
    }
    return semver.compare(v1, v2);
}
