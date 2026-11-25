import { GetInheritedRulesKodyRulesUseCase } from './get-inherited-kody-rules.use-case';

/** Which inherited rules the listing marks as excluded. Synthetic rules only. */
describe('GetInheritedRulesKodyRulesUseCase: excluded marks', () => {
    const useCase = Object.create(
        GetInheritedRulesKodyRulesUseCase.prototype,
    ) as GetInheritedRulesKodyRulesUseCase;

    const rule = (exclude: string[] | undefined) =>
        ({
            uuid: 'g1',
            rule: 'A global rule',
            repositoryId: 'global',
            inheritance: exclude
                ? { inheritable: true, exclude, include: [] }
                : undefined,
        }) as any;

    const marked = (
        exclude: string[] | undefined,
        repositoryId: string,
        directoryId?: string,
    ) =>
        (useCase as any).setRuleOrigins(
            [rule(exclude)],
            repositoryId,
            directoryId,
        ).globalRules[0].excluded;

    it('marks a rule excluded for the repository, with or without a directory', () => {
        expect(marked(['repoA'], 'repoA')).toBe(true);
        expect(marked(['repoA'], 'repoA', 'dirX')).toBe(true);
    });

    it('marks a rule excluded for the directory', () => {
        expect(marked(['dirX'], 'repoA', 'dirX')).toBe(true);
    });

    it('leaves a rule that excludes something else unmarked', () => {
        expect(marked(['repoB'], 'repoA', 'dirX')).toBe(false);
        expect(marked(['dirY'], 'repoA', 'dirX')).toBe(false);
        expect(marked([], 'repoA')).toBe(false);
        expect(marked(undefined, 'repoA')).toBe(false);
    });
});
