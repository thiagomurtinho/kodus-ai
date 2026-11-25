import { GithubService } from './github.service';

jest.mock('@libs/mcp-server/services/mcp-manager.service', () => ({
    MCPManagerService: jest.fn(),
}));

/** The issues GitHub ties to a pull request. Synthetic data only. */
describe('GithubService.getPullRequestLinkedIssues', () => {
    const repository = { owner: 'acme', name: 'web' };
    const params = {
        organizationAndTeamData: { organizationId: 'org-1' },
        repository,
        prNumber: 42,
    };

    function serviceWith(answer: () => unknown) {
        const graphql = jest.fn(async () => answer());
        const service = Object.create(GithubService.prototype) as GithubService;
        (service as any).instanceGraphQL = async () => graphql;
        (service as any).logger = { warn: jest.fn() };
        return { service, graphql };
    }

    const pullRequest = (extra: Record<string, unknown>) => ({
        repository: { pullRequest: extra },
    });

    it('reads the closing links and the same-repository issues that mention the PR', async () => {
        const { service, graphql } = serviceWith(() =>
            pullRequest({
                closingIssuesReferences: {
                    nodes: [
                        {
                            number: 7,
                            repository: { nameWithOwner: 'acme/web' },
                        },
                        {
                            number: 3,
                            repository: { nameWithOwner: 'acme/specs' },
                        },
                    ],
                },
                timelineItems: {
                    nodes: [
                        {
                            isCrossRepository: false,
                            source: {
                                __typename: 'Issue',
                                number: 7,
                                repository: { nameWithOwner: 'acme/web' },
                            },
                        },
                        {
                            isCrossRepository: false,
                            source: { __typename: 'PullRequest', number: 9 },
                        },
                        {
                            isCrossRepository: true,
                            source: {
                                __typename: 'Issue',
                                number: 5,
                                repository: { nameWithOwner: 'other/repo' },
                            },
                        },
                        {
                            isCrossRepository: false,
                            source: {
                                __typename: 'Issue',
                                number: 7,
                                repository: { nameWithOwner: 'acme/web' },
                            },
                        },
                        {},
                    ],
                },
            }),
        );
        const result = await service.getPullRequestLinkedIssues(params);
        expect(result).toEqual({
            closing: [
                { number: 7 },
                { number: 3, repository: { owner: 'acme', name: 'specs' } },
            ],
            crossReferencing: [{ number: 7 }],
        });
        expect(graphql).toHaveBeenCalledWith(
            expect.stringContaining('closingIssuesReferences'),
            { owner: 'acme', name: 'web', number: 42 },
        );
    });

    it.each([
        ['an empty answer', () => ({})],
        ['no pull request', () => ({ repository: { pullRequest: null } })],
    ])('answers with none on %s', async (_label, answer) => {
        const { service } = serviceWith(answer);
        await expect(
            service.getPullRequestLinkedIssues(params),
        ).resolves.toEqual({
            closing: [],
            crossReferencing: [],
        });
    });

    it('never throws: a failed query answers with none', async () => {
        const { service } = serviceWith(() => {
            throw new Error('Resource not accessible by integration');
        });
        await expect(
            service.getPullRequestLinkedIssues(params),
        ).resolves.toEqual({
            closing: [],
            crossReferencing: [],
        });
    });
});
