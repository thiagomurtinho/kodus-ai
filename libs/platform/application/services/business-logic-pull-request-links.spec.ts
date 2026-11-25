import { withPullRequestLinks } from './business-logic-pull-request-links';

const request = (extra: Record<string, unknown> = {}) =>
    ({
        door: 'auto',
        organizationAndTeamData: { organizationId: 'org-1' },
        repository: { id: 'r1', name: 'web', owner: 'acme' },
        pullRequest: { number: 42 },
        platformType: 'GITHUB',
        diff: '',
        ...extra,
    }) as any;

describe('withPullRequestLinks', () => {
    it('reads the links once, only when asked, and shares the answer', async () => {
        const code = {
            getPullRequestLinkedIssues: jest.fn(async () => ({
                closing: [{ number: 7 }],
                crossReferencing: [{ number: 8 }],
                crossReferencingTruncated: true,
            })),
        };
        const wrapped = withPullRequestLinks(request(), code as any);
        expect(code.getPullRequestLinkedIssues).not.toHaveBeenCalled();
        expect(await wrapped.pullRequestLinks!.closingIssues()).toEqual([
            { number: 7 },
        ]);
        expect(
            await wrapped.pullRequestLinks!.crossReferencingIssues(),
        ).toEqual([{ number: 8 }]);
        expect(
            await wrapped.pullRequestLinks!.crossReferencingTruncated!(),
        ).toBe(true);
        expect(code.getPullRequestLinkedIssues).toHaveBeenCalledTimes(1);
        expect(code.getPullRequestLinkedIssues).toHaveBeenCalledWith(
            expect.objectContaining({
                repository: { owner: 'acme', name: 'web' },
                prNumber: 42,
            }),
            'GITHUB',
        );
    });

    it('answers with none when the lookup fails', async () => {
        const code = {
            getPullRequestLinkedIssues: jest.fn(async () => {
                throw new Error('boom');
            }),
        };
        const wrapped = withPullRequestLinks(request(), code as any);
        expect(await wrapped.pullRequestLinks!.closingIssues()).toEqual([]);
    });

    it('leaves a request with no PR, or no owner, as it is', () => {
        const code = { getPullRequestLinkedIssues: jest.fn() };
        const noPr = request({ pullRequest: undefined });
        const noOwner = request({
            repository: { id: 'r1', name: 'web' },
        });
        expect(withPullRequestLinks(noPr, code as any)).toBe(noPr);
        expect(withPullRequestLinks(noOwner, code as any)).toBe(noOwner);
    });
});
