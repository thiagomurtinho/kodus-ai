/**
 * @license
 * Kodus Tech. All rights reserved.
 */

import type { IKodyRule } from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

/**
 * Whether a rule's `inheritance` lets it apply in a repository (and
 * directory). The one check behind the UI listing and the code review, so a
 * global rule or memory an org excluded from a repository is left out of both.
 */
export function matchesInheritance(
    rule: Partial<IKodyRule>,
    filters: {
        directoryId?: string;
        repositoryId?: string;
        useInclude?: boolean;
        useExclude?: boolean;
        /**
         * Skip the `inheritable` switch and honor only exclude and include.
         * The code review uses it: a global rule marked non-inheritable still
         * reviews every repository it is not excluded from.
         */
        ignoreInheritable?: boolean;
    },
): boolean {
    const {
        directoryId,
        repositoryId,
        useInclude = true,
        useExclude = true,
        ignoreInheritable = false,
    } = filters;
    // If we aren't checking a specific directory or repository, all rules match.
    if (!directoryId && !repositoryId) {
        return true;
    }

    // A null list or switch reads like an absent one.
    const inheritable = rule.inheritance?.inheritable ?? true;
    const exclude = rule.inheritance?.exclude ?? [];
    const include = rule.inheritance?.include ?? [];

    // If the rule is not inheritable, it doesn't match.
    if (!ignoreInheritable && !inheritable) {
        return false;
    }

    // Cross-directory leak guard. The historical default for a
    // rule's `inheritance.include` is `[]`, which the matcher
    // below reads as "inherit everywhere" — and so a rule
    // scoped to one directory would silently apply in every
    // sibling directory of the same repo (customer-reported
    // on rule b207a89c).
    //
    // A directory-scoped rule (`rule.directoryId` set) must NOT
    // leak into a different directory unless that directory is
    // explicitly in `include`. Repo-level and global rules
    // (`rule.directoryId` undefined) keep their original
    // semantics and continue to match across all contexts.
    if (
        directoryId &&
        rule.directoryId &&
        rule.directoryId !== directoryId &&
        !include.includes(directoryId)
    ) {
        return false;
    }

    // Check if the current directory or repository is excluded or included
    const isExcluded =
        useExclude &&
        ((directoryId && exclude.includes(directoryId)) ||
            (repositoryId && exclude.includes(repositoryId)));

    const isIncluded =
        useInclude &&
        ((directoryId && include.includes(directoryId)) ||
            (repositoryId && include.includes(repositoryId)));

    // If excluded, it doesn't match. If not excluded, it matches if include is empty or it is included.
    return !isExcluded && (include.length === 0 || isIncluded);
}
