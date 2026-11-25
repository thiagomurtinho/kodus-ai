import {
    KodyRulesStatus,
    KodyRulesType,
} from '@libs/kodyRules/domain/interfaces/kodyRules.interface';

import { KodyRulesValidationService } from './kody-rules-validation.service';

/**
 * The review (filterKodyRules) applies a global rule's or memory's
 * `inheritance` exactly as the UI listing (getKodyRulesForFolder) does.
 * Synthetic rules only.
 */
describe('KodyRulesValidationService.filterKodyRules: inheritance of global rules', () => {
    const service = new KodyRulesValidationService({} as any);

    const global = (
        uuid: string,
        inheritance: unknown,
        type = KodyRulesType.STANDARD,
    ) =>
        ({
            uuid,
            rule: `Rule ${uuid}`,
            type,
            status: KodyRulesStatus.ACTIVE,
            repositoryId: 'global',
            createdAt: new Date('2026-01-01'),
            inheritance,
        }) as any;

    const reviewed = (
        rules: any[],
        repositoryId: string,
        directoryId?: string,
    ) => {
        const { standardRules, memoryRules } = service.filterKodyRules(
            rules,
            repositoryId,
            directoryId,
            false,
        );
        return {
            standard: standardRules.map((r) => r.uuid),
            memory: memoryRules.map((r) => r.uuid),
        };
    };

    const ui = (rules: any[], repositoryId: string, directoryId?: string) =>
        service
            .getKodyRulesForFolder(null, rules, { repositoryId, directoryId })
            .map((r) => r.uuid);

    it('drops a global rule for a repository its exclude names, and keeps it for another', () => {
        const rule = global('g1', {
            inheritable: true,
            exclude: ['repoA'],
            include: [],
        });
        expect(reviewed([rule], 'repoA').standard).toEqual([]);
        expect(reviewed([rule], 'repoB').standard).toEqual(['g1']);
    });

    it('does the same for a memory with its own inheritance', () => {
        const memory = global(
            'm1',
            { inheritable: true, exclude: ['repoA'], include: [] },
            KodyRulesType.MEMORY,
        );
        expect(reviewed([memory], 'repoA').memory).toEqual([]);
        expect(reviewed([memory], 'repoB').memory).toEqual(['m1']);
    });

    it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty object', {}],
        ['empty lists', { inheritable: true, exclude: [], include: [] }],
    ])(
        'applies a global rule and a memory with %s inheritance everywhere, as today',
        (_label, inheritance) => {
            const rules = [
                global('g1', inheritance),
                global('m1', inheritance, KodyRulesType.MEMORY),
            ];
            expect(reviewed(rules, 'repoA')).toEqual({
                standard: ['g1'],
                memory: ['m1'],
            });
        },
    );

    it('applies only to the repositories an include list names', () => {
        const rule = global('g1', {
            inheritable: true,
            exclude: [],
            include: ['repoA'],
        });
        expect(reviewed([rule], 'repoA').standard).toEqual(['g1']);
        expect(reviewed([rule], 'repoB').standard).toEqual([]);
    });

    it('drops a global rule that is not inheritable', () => {
        const rule = global('g1', {
            inheritable: false,
            exclude: [],
            include: [],
        });
        expect(reviewed([rule], 'repoA').standard).toEqual([]);
    });

    it('honors an excluded directory of the reviewed repository', () => {
        const rule = global('g1', {
            inheritable: true,
            exclude: ['dirX'],
            include: [],
        });
        expect(reviewed([rule], 'repoA', 'dirX').standard).toEqual([]);
        expect(reviewed([rule], 'repoA', 'dirY').standard).toEqual(['g1']);
    });

    it('keeps the review in step with the UI listing for every inheritance shape', () => {
        const shapes = [
            null,
            { inheritable: true, exclude: ['repoA'], include: [] },
            { inheritable: true, exclude: [], include: ['repoA'] },
            { inheritable: true, exclude: ['repoA'], include: ['repoA'] },
            { inheritable: false, exclude: [], include: [] },
            { inheritable: true, exclude: ['dirX'], include: [] },
        ];
        for (const shape of shapes) {
            const rules = [
                global('g1', shape),
                global('m1', shape, KodyRulesType.MEMORY),
            ];
            for (const [repo, dir] of [
                ['repoA', undefined],
                ['repoB', undefined],
                ['repoA', 'dirX'],
            ] as const) {
                const review = reviewed(rules, repo, dir);
                expect([...review.standard, ...review.memory].sort()).toEqual(
                    ui(rules, repo, dir).sort(),
                );
            }
        }
    });

    it('still keeps a paused global rule out, whatever its inheritance', () => {
        const paused = {
            ...global('g1', null),
            status: KodyRulesStatus.PAUSED,
        };
        expect(reviewed([paused], 'repoA').standard).toEqual([]);
    });
});
