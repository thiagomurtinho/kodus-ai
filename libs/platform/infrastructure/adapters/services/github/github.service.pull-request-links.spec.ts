import { GraphqlResponseError } from '@octokit/graphql';

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
                createdAt: '2026-11-10T00:00:00Z',
                timelineItems: {
                    nodes: [
                        {
                            isCrossRepository: false,
                            source: {
                                __typename: 'Issue',
                                state: 'OPEN',
                                createdAt: '2026-11-01T00:00:00Z',
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
                                state: 'OPEN',
                                createdAt: '2026-11-01T00:00:00Z',
                                number: 5,
                                repository: { nameWithOwner: 'other/repo' },
                            },
                        },
                        {
                            isCrossRepository: false,
                            source: {
                                __typename: 'Issue',
                                state: 'OPEN',
                                createdAt: '2026-11-01T00:00:00Z',
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

    const responseError = (data: unknown) =>
        new GraphqlResponseError({ query: '', variables: {} } as any, {}, {
            data,
            errors: [
                {
                    type: 'FORBIDDEN',
                    message: 'Resource not accessible by integration',
                },
            ],
        } as any);

    it('keeps the data of a response that also carries errors', async () => {
        const { service } = serviceWith(() => {
            throw responseError({
                repository: {
                    pullRequest: {
                        closingIssuesReferences: {
                            nodes: [
                                {
                                    number: 7,
                                    repository: { nameWithOwner: 'acme/web' },
                                },
                                null,
                            ],
                        },
                    },
                },
            });
        });
        const result = await service.getPullRequestLinkedIssues(params);
        expect(result.closing).toEqual([{ number: 7 }]);
    });

    it('keeps the closing links when the cross-reference query fails outright', async () => {
        const graphql = jest.fn(async (query: string) => {
            if (query.includes('timelineItems')) {
                throw new Error('502 Bad Gateway');
            }
            return pullRequest({
                closingIssuesReferences: {
                    nodes: [
                        {
                            number: 7,
                            repository: { nameWithOwner: 'acme/web' },
                        },
                    ],
                },
            });
        });
        const service = Object.create(GithubService.prototype) as GithubService;
        (service as any).instanceGraphQL = async () => graphql;
        (service as any).logger = { warn: jest.fn() };
        await expect(
            service.getPullRequestLinkedIssues(params),
        ).resolves.toEqual({ closing: [{ number: 7 }], crossReferencing: [] });
        expect(graphql).toHaveBeenCalledTimes(2);
    });

    it('keeps the cross-references when the closing-links query fails outright', async () => {
        const graphql = jest.fn(async (query: string) => {
            if (query.includes('closingIssuesReferences')) {
                throw new Error('502 Bad Gateway');
            }
            return pullRequest({
                createdAt: '2026-11-10T00:00:00Z',
                timelineItems: {
                    nodes: [
                        {
                            isCrossRepository: false,
                            source: {
                                __typename: 'Issue',
                                state: 'OPEN',
                                createdAt: '2026-11-01T00:00:00Z',
                                number: 8,
                                repository: { nameWithOwner: 'acme/web' },
                            },
                        },
                    ],
                },
            });
        });
        const service = Object.create(GithubService.prototype) as GithubService;
        (service as any).instanceGraphQL = async () => graphql;
        (service as any).logger = { warn: jest.fn() };
        await expect(
            service.getPullRequestLinkedIssues(params),
        ).resolves.toEqual({ closing: [], crossReferencing: [{ number: 8 }] });
    });

    const mention = (number: number, state: string, createdAt: string) => ({
        isCrossRepository: false,
        source: {
            __typename: 'Issue',
            number,
            state,
            createdAt,
            repository: { nameWithOwner: 'acme/web' },
        },
    });

    it('counts only open issues that were there before the pull request', async () => {
        const { service } = serviceWith(() =>
            pullRequest({
                createdAt: '2026-11-10T00:00:00Z',
                timelineItems: {
                    pageInfo: { hasNextPage: false },
                    nodes: [
                        mention(1, 'OPEN', '2026-11-01T00:00:00Z'),
                        mention(2, 'CLOSED', '2026-11-01T00:00:00Z'),
                        mention(3, 'OPEN', '2026-11-11T00:00:00Z'),
                        mention(4, 'OPEN', 'not a date'),
                    ],
                },
            }),
        );
        const result = await service.getPullRequestLinkedIssues(params);
        expect(result.crossReferencing).toEqual([{ number: 1 }]);
        expect(result.crossReferencingTruncated).toBeUndefined();
    });

    it('says the mentions are cut short when the timeline has another page', async () => {
        const { service } = serviceWith(() =>
            pullRequest({
                createdAt: '2026-11-10T00:00:00Z',
                timelineItems: {
                    pageInfo: { hasNextPage: true },
                    nodes: [mention(1, 'OPEN', '2026-11-01T00:00:00Z')],
                },
            }),
        );
        const result = await service.getPullRequestLinkedIssues(params);
        expect(result.crossReferencing).toEqual([{ number: 1 }]);
        expect(result.crossReferencingTruncated).toBe(true);
    });

    it('counts none without the date of the pull request', async () => {
        const { service } = serviceWith(() =>
            pullRequest({
                timelineItems: {
                    nodes: [mention(1, 'OPEN', '2026-11-01T00:00:00Z')],
                },
            }),
        );
        const result = await service.getPullRequestLinkedIssues(params);
        expect(result.crossReferencing).toEqual([]);
    });
});
