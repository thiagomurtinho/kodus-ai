import type { TaskReference } from './business-validation.types';
import { BusinessValidationService } from './business-validation.service';
import { resolveBusinessLogicSettings } from './settings';
import { buildTaskTrackers } from './trackers/tracker-catalog';

jest.mock('./trackers/tracker-catalog', () => {
    const actual = jest.requireActual('./trackers/tracker-catalog');
    return { ...actual, buildTaskTrackers: jest.fn(actual.buildTaskTrackers) };
});

/**
 * Which task a PR is checked against: the order the references are tried in.
 *
 *   1. the command (`@kody -v business-logic #N`)
 *   2. the issues GitHub itself links to the PR (closingIssuesReferences)
 *   3. what the title or body states or cites (`Closes #N`, `Refs org/repo#N`)
 *   4. a single issue of the repository that cross-references the PR
 *   5. the branch name, as a numeric hint only
 *   6. otherwise a clear message, naming the candidates when there are several
 *
 * The native links come from the caller as lazy lookups on the request
 * (`pullRequestLinks`), so they cost a call only when a step needs them.
 * Synthetic data only.
 */
type IssueRef = {
    number: number;
    repository?: { owner: string; name: string };
};

const REPOSITORY = { id: 'repo-1', owner: 'org', name: 'repo' };

/** A Git Issues tracker that reads issues of org/repo and nothing else. */
function gitIssues(titles: Record<string, string>) {
    const reads: string[] = [];
    const tracker = {
        name: 'Git Issues',
        canRead: (reference: TaskReference) => reference.kind === 'git_issue',
        read: async (reference: TaskReference) => {
            reads.push(reference.id);
            const foreign =
                reference.kind === 'git_issue' &&
                reference.repository &&
                `${reference.repository.owner}/${reference.repository.name}` !==
                    'org/repo';
            const title = titles[reference.id];
            return !foreign && title
                ? {
                      status: 'found' as const,
                      task: {
                          tracker: 'Git Issues',
                          id: `#${reference.id}`,
                          title,
                          description: 'What the work is, in a sentence.',
                      },
                      tools: [],
                  }
                : { status: 'not_found' as const, tools: [] };
        },
        close: async () => undefined,
    };
    return { tracker, reads };
}

/** A Jira tracker that reads keys only. */
function jira(titles: Record<string, string>) {
    return {
        name: 'Jira',
        canRead: (reference: TaskReference) => reference.kind === 'key',
        read: async (reference: TaskReference) =>
            titles[reference.id]
                ? {
                      status: 'found' as const,
                      task: {
                          tracker: 'Jira',
                          id: reference.id,
                          title: titles[reference.id],
                          description: 'What the work is, in a sentence.',
                      },
                      tools: [],
                  }
                : { status: 'not_found' as const, tools: [] },
        ownsReference: async () => true,
        close: async () => undefined,
    };
}

function links(closing: IssueRef[] = [], crossReferencing: IssueRef[] = []) {
    return {
        closingIssues: jest.fn(async () => closing),
        crossReferencingIssues: jest.fn(async () => crossReferencing),
    };
}

function setup(trackers: unknown[]) {
    (buildTaskTrackers as jest.Mock).mockReturnValueOnce(trackers);
    const service = new BusinessValidationService(
        { getConnections: async () => [] } as any,
        {} as any,
        { findByKey: async () => undefined } as any,
        {} as any,
    );
    jest.spyOn(service as any, 'lazyJudge').mockReturnValue(async () => ({
        translate: async (message: string) => message,
        modelSlot: {},
    }));
    return service;
}

function request(
    pullRequest: { title?: string; body?: string; headRef?: string },
    extra: Record<string, unknown> = {},
) {
    return {
        door: 'auto',
        organizationAndTeamData: { organizationId: 'org-1', teamId: 'team-1' },
        repository: REPOSITORY,
        pullRequest: { number: 342, ...pullRequest },
        settings: resolveBusinessLogicSettings({ requireTask: true }),
        diff: '+profile',
        ...extra,
    } as any;
}

/** The tasks the resolution found, read from what the service decided on. */
async function resolved(service: BusinessValidationService, req: unknown) {
    const decide = jest
        .spyOn(service as any, 'decide')
        .mockResolvedValue({ kind: 'skipped', reason: 'x', message: '' });
    await (service as any).run(req);
    const resolution = decide.mock.calls[0][2] as {
        kind: string;
        tasks?: Array<{ task: { id: string } }>;
    };
    return {
        kind: resolution.kind,
        ids: (resolution.tasks ?? []).map((f) => f.task.id),
    };
}

/** What the author is told when no task was found. */
async function told(service: BusinessValidationService, req: unknown) {
    return (await (service as any).run(req)).outcome as {
        kind: string;
        message: string;
    };
}

const titles = {
    '311': 'Profile page',
    '341': 'Kodus profile',
    '999': 'Something else entirely',
    '123': 'Unrelated mention',
    '77': 'Other work',
    '12': 'Profile avatar',
    '14': 'Profile settings',
};

describe('Business Logic reference resolution: native GitHub links', () => {
    it('reads the issue the PR cites in the body when the branch names a non-numeric key (WORK-341)', async () => {
        const { tracker } = gitIssues(titles);
        const found = await resolved(
            setup([tracker]),
            request({
                title: 'Add the Kodus profile',
                body: 'Refs org/repo#341',
                headRef: 'work-341/kodus-profile',
            }),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#341'] });
    });

    it('prefers the issue GitHub links to the PR over the branch hint and over body mentions', async () => {
        const { tracker, reads } = gitIssues(titles);
        const pullRequestLinks = links([{ number: 341 }]);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Add the Kodus profile',
                    body: 'See #123 for context',
                    headRef: 'work/999-something-else',
                },
                { pullRequestLinks },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#341'] });
        expect(reads).toEqual(['341']);
        expect(pullRequestLinks.closingIssues).toHaveBeenCalledTimes(1);
    });

    it('uses the native link when the branch has no number and the body cites nothing', async () => {
        const { tracker } = gitIssues(titles);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Add the Kodus profile',
                    body: 'Adds the page.',
                    headRef: 'feature/x',
                },
                { pullRequestLinks: links([{ number: 341 }]) },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#341'] });
    });

    it('ignores a native link it cannot read and goes on to what the body states', async () => {
        const { tracker } = gitIssues(titles);
        const pullRequestLinks = links([
            { number: 5, repository: { owner: 'other', name: 'private' } },
        ]);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Add the profile',
                    body: 'Closes #77',
                    headRef: 'feature/x',
                },
                { pullRequestLinks },
            ),
        );
        expect(pullRequestLinks.closingIssues).toHaveBeenCalledTimes(1);
        expect(found).toEqual({ kind: 'found', ids: ['#77'] });
    });

    it('lets the command win over the native link, the body and the branch', async () => {
        const { tracker, reads } = gitIssues(titles);
        const pullRequestLinks = links([{ number: 999 }]);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Add the profile',
                    body: 'Closes #77',
                    headRef: 'work/311-profile-page',
                },
                { taskInput: '#341', pullRequestLinks },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#341'] });
        expect(reads).toEqual(['341']);
        expect(pullRequestLinks.closingIssues).not.toHaveBeenCalled();
    });
});

describe('Business Logic reference resolution: issues that cross-reference the PR', () => {
    it('uses the one issue of the repository that mentions the PR when nothing else names a task', async () => {
        const { tracker } = gitIssues(titles);
        const pullRequestLinks = links([], [{ number: 341 }]);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Add the Kodus profile',
                    body: 'Adds the page.',
                    headRef: 'feature/x',
                },
                { pullRequestLinks },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#341'] });
    });

    it('does not look for cross-references when the body already states the task', async () => {
        const { tracker } = gitIssues(titles);
        const pullRequestLinks = links([], [{ number: 12 }]);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Add the profile',
                    body: 'Closes #77',
                    headRef: 'feature/x',
                },
                { pullRequestLinks },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#77'] });
        expect(pullRequestLinks.crossReferencingIssues).not.toHaveBeenCalled();
    });

    it('names both candidates and judges neither when two issues mention the PR', async () => {
        const { tracker, reads } = gitIssues(titles);
        const outcome = await told(
            setup([tracker]),
            request(
                {
                    title: 'Add the profile',
                    body: 'Adds the page.',
                    headRef: 'feature/x',
                },
                {
                    pullRequestLinks: links(
                        [],
                        [{ number: 12 }, { number: 14 }],
                    ),
                },
            ),
        );
        expect(reads).toEqual([]);
        expect(outcome.kind).toBe('task_required');
        expect(outcome.message).toContain('#12');
        expect(outcome.message).toContain('#14');
        expect(outcome.message).toContain('Development');
    });
});

describe('Business Logic reference resolution: nothing found', () => {
    it('tells the author to link the issue under Development or name it in the command', async () => {
        const { tracker } = gitIssues(titles);
        const outcome = await told(
            setup([tracker]),
            request(
                {
                    title: 'Add the profile',
                    body: 'Adds the page.',
                    headRef: 'feature/x',
                },
                { pullRequestLinks: links() },
            ),
        );
        expect(outcome.kind).toBe('task_required');
        expect(outcome.message).toContain('Development');
        expect(outcome.message).toContain('@kody -v business-logic');
        expect(outcome.message).toMatch(/#\d+|issue number/i);
    });

    it('says the same when the caller supplies no native links at all', async () => {
        const { tracker } = gitIssues(titles);
        const outcome = await told(
            setup([tracker]),
            request({ title: 'Add the profile', headRef: 'feature/x' }),
        );
        expect(outcome.message).toContain('Development');
    });
});

describe('Business Logic reference resolution: what keeps working', () => {
    it('reads the numeric branch of a PR with no link and no citation (work/311-x)', async () => {
        const { tracker } = gitIssues(titles);
        const found = await resolved(
            setup([tracker]),
            request(
                {
                    title: 'Profile page',
                    body: 'Adds the page.',
                    headRef: 'work/311-profile-page',
                },
                { pullRequestLinks: links() },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['#311'] });
    });

    it('reads a Jira key from the branch when Jira is connected and nothing else names a task', async () => {
        const found = await resolved(
            setup([
                jira({ 'PAY-42': 'Refund flow' }),
                gitIssues(titles).tracker,
            ]),
            request(
                {
                    title: 'Refund flow',
                    body: 'Adds refunds.',
                    headRef: 'feature/PAY-42-refunds',
                },
                { pullRequestLinks: links() },
            ),
        );
        expect(found).toEqual({ kind: 'found', ids: ['PAY-42'] });
    });
});
