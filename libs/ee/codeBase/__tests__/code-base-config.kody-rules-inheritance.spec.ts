import CodeBaseConfigService from '@libs/ee/codeBase/codeBaseConfig.service';
import { KodyRulesValidationService } from '@libs/ee/kodyRules/service/kody-rules-validation.service';
import {
    KodyRulesStatus,
    KodyRulesType,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

/**
 * The server review (getConfig) hands the review the global rules and
 * memories that apply to the reviewed repository: one whose `inheritance`
 * excludes it never reaches the review. Synthetic data only.
 */
describe('CodeBaseConfigService.getConfig: inheritance of global rules', () => {
    const organizationAndTeamData = {
        organizationId: 'org-1',
        teamId: 'team-1',
    };

    const rule = (uuid: string, type: KodyRulesType, exclude: string[]) => ({
        uuid,
        rule: `Rule ${uuid}`,
        type,
        status: KodyRulesStatus.ACTIVE,
        repositoryId: 'global',
        createdAt: new Date('2026-01-01'),
        inheritance: { inheritable: true, exclude, include: [] },
    });
    const rules = [
        rule('g-excluded', KodyRulesType.STANDARD, ['repo-A']),
        rule('g-kept', KodyRulesType.STANDARD, ['repo-other']),
        rule('m-excluded', KodyRulesType.MEMORY, ['repo-A']),
        rule('m-kept', KodyRulesType.MEMORY, []),
    ];

    function serviceFor() {
        const entity = { toObject: () => ({ rules }) };
        const service = new CodeBaseConfigService(
            {} as any,
            {} as any,
            {} as any,
            {
                findOne: jest.fn().mockResolvedValue({ configValue: {} }),
                findByKey: jest
                    .fn()
                    .mockResolvedValue({ configValue: 'en-US' }),
            } as any,
            {
                findLiveRulesByOrganizationId: jest
                    .fn()
                    .mockResolvedValue(entity),
                syncRulesWithPlanLimit: jest.fn().mockResolvedValue(null),
            } as any,
            {} as any,
            {
                verifyConnection: jest.fn().mockResolvedValue({
                    hasConnection: true,
                    isSetupComplete: true,
                }),
            } as any,
            new KodyRulesValidationService({} as any),
            {
                shouldLimitResources: jest.fn().mockResolvedValue(false),
            } as any,
            {} as any,
        );
        jest.spyOn(service as any, 'getDefaultBranch').mockResolvedValue(
            'main',
        );
        jest.spyOn(
            service as any,
            'getReviewModeConfigParameter',
        ).mockResolvedValue({});
        jest.spyOn(
            service as any,
            'getMergedCodeReviewConfigs',
        ).mockResolvedValue({
            directoryId: undefined,
            ignorePaths: [],
            v2PromptOverrides: {},
        });
        jest.spyOn(service as any, 'sanitizeV2PromptOverrides').mockReturnValue(
            {},
        );
        return service;
    }

    it('leaves out the global rule and the memory that exclude the reviewed repository', async () => {
        const config = await serviceFor().getConfig(organizationAndTeamData, {
            id: 'repo-A',
            name: 'a',
        } as any);
        expect(config.kodyRules.map((r: any) => r.uuid)).toEqual(['g-kept']);
        expect(config.kodyMemoryRules.map((r: any) => r.uuid)).toEqual([
            'm-kept',
        ]);
    });

    it('gives another repository every one of them', async () => {
        const config = await serviceFor().getConfig(organizationAndTeamData, {
            id: 'repo-B',
            name: 'b',
        } as any);
        expect(config.kodyRules.map((r: any) => r.uuid).sort()).toEqual([
            'g-excluded',
            'g-kept',
        ]);
        expect(config.kodyMemoryRules.map((r: any) => r.uuid).sort()).toEqual([
            'm-excluded',
            'm-kept',
        ]);
    });
});
