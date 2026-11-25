import type {
    BusinessValidationRequest,
    LinkedIssue,
} from '@libs/agents/business-validation/business-validation.types';
import { PlatformType } from '@libs/core/domain/enums/platform-type.enum';
import type { PullRequestLinkedIssues } from '@libs/platform/domain/platformIntegrations/types/codeManagement/issues.type';
import { CodeManagementService } from '@libs/platform/infrastructure/adapters/services/codeManagement.service';

/**
 * The request with lazy lookups of the issues the host ties to the PR (its
 * Development sidebar, closing keywords, issues that mention it). Only GitHub
 * has them: any other platform's request is left as it is. Each lookup runs
 * only when a resolution step asks (a PR whose command or description names
 * the task never pays for them), and the two share one memoised read of the
 * host. A failed lookup answers with none. A request with no PR, or no owner
 * to query under, is left as it is too.
 */
export function withPullRequestLinks(
    request: BusinessValidationRequest,
    code: Pick<CodeManagementService, 'getPullRequestLinkedIssues'>,
): BusinessValidationRequest {
    const { repository, pullRequest, organizationAndTeamData } = request;
    const owner = repository?.owner ?? repository?.fullName?.split('/')[0];
    if (
        String(request.platformType).toUpperCase() !== PlatformType.GITHUB ||
        request.pullRequestLinks ||
        !repository?.name ||
        !owner ||
        !pullRequest?.number
    ) {
        return request;
    }
    let linked: Promise<PullRequestLinkedIssues> | undefined;
    const read = () =>
        (linked ??= code
            .getPullRequestLinkedIssues(
                {
                    organizationAndTeamData,
                    repository: { owner, name: repository.name },
                    prNumber: pullRequest.number,
                },
                request.platformType as PlatformType | undefined,
            )
            .catch(() => ({ closing: [], crossReferencing: [] })));
    return {
        ...request,
        pullRequestLinks: {
            closingIssues: async (): Promise<LinkedIssue[]> =>
                (await read()).closing,
            crossReferencingIssues: async (): Promise<LinkedIssue[]> =>
                (await read()).crossReferencing,
            crossReferencingTruncated: async (): Promise<boolean> =>
                !!(await read()).crossReferencingTruncated,
        },
    };
}
