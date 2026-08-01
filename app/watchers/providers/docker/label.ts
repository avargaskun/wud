/**
 * WUD supported Docker labels.
 */

/**
 * Should the container be tracked? (true | false).
 */
export const wudWatch = 'wud.watch';

/**
 * Optional regex indicating what tags to consider.
 */
export const wudTagInclude = 'wud.tag.include';

/**
 * Optional regex indicating what tags to not consider.
 */
export const wudTagExclude = 'wud.tag.exclude';

/**
 * Optional transform function to apply to the tag.
 */
export const wudTagTransform = 'wud.tag.transform';

/**
 * Should container digest be tracked? (true | false).
 */
export const wudWatchDigest = 'wud.watch.digest';

/**
 * Should digest be tracked for a semver tagged container? (true | false).
 * Dedicated label: wud.watch.digest is inert on semver tags today, so honouring
 * it here would silently activate digest watching on upgrade.
 */
export const wudWatchDigestSemver = 'wud.watch.digest.semver';

/**
 * Optional templated string pointing to a browsable link.
 */
export const wudLinkTemplate = 'wud.link.template';

/**
 * Optional friendly name to display.
 */
export const wudDisplayName = 'wud.display.name';

/**
 * Optional friendly icon to display.
 */
export const wudDisplayIcon = 'wud.display.icon';

/**
 * Optional list of triggers to include
 */
export const wudTriggerInclude = 'wud.trigger.include';

/**
 * Optional list of triggers to exclude
 */
export const wudTriggerExclude = 'wud.trigger.exclude';

/**
 * Optional comma-separated list of dependent containers to bounce after this container is updated.
 */
export const wudPostupdateRestart = 'wud.postupdate.restart';
