import { describe, expect, it } from 'vitest'
import { paint } from '../../src/output/color.js'
import type { SyncPlan } from '../../src/sync/diff.js'
import { renderPlan } from '../../src/sync/render.js'

function mkPlan(overrides: Partial<SyncPlan> = {}): SyncPlan {
    return {
        create: [],
        update: [],
        del: [],
        unchanged: 0,
        caseCollisions: [],
        ...overrides
    }
}

describe('renderPlan', () => {
    it('renders a git-push style summary line with counts', () => {
        const plan = mkPlan({
            create: [
                { relPath: 'a.md', size: 1, absPath: '/x/a.md' },
                { relPath: 'b.md', size: 2, absPath: '/x/b.md' },
                { relPath: 'c.md', size: 3, absPath: '/x/c.md' }
            ],
            update: [
                {
                    relPath: 'd.md',
                    size: 4,
                    absPath: '/x/d.md',
                    sourceId: 'src_d'
                },
                {
                    relPath: 'e.md',
                    size: 5,
                    absPath: '/x/e.md',
                    sourceId: 'src_e'
                }
            ],
            del: [{ sourceId: 'src_f', name: 'f.md' }],
            unchanged: 4
        })
        const rendered = renderPlan(plan, paint(false))
        expect(rendered.split('\n')[0]).toBe(
            '+3 created  ~2 updated  −1 deleted  (4 unchanged)'
        )
    })

    it('lists each created/updated/deleted file with a +/~/− prefix', () => {
        const plan = mkPlan({
            create: [
                {
                    relPath: 'docs/guide.md',
                    size: 1,
                    absPath: '/x/docs/guide.md'
                }
            ],
            update: [
                {
                    relPath: 'report.pdf',
                    size: 2,
                    absPath: '/x/report.pdf',
                    sourceId: 'src_r'
                }
            ],
            del: [{ sourceId: 'src_o', name: 'old.txt' }],
            unchanged: 0
        })
        const rendered = renderPlan(plan, paint(false))
        const lines = rendered.split('\n')
        expect(lines).toContain('  + docs/guide.md')
        expect(lines).toContain('  ~ report.pdf')
        expect(lines).toContain('  − old.txt')
    })

    it('produces an empty-plan summary with all-zero counts', () => {
        const rendered = renderPlan(mkPlan(), paint(false))
        expect(rendered.split('\n')[0]).toBe(
            '+0 created  ~0 updated  −0 deleted  (0 unchanged)'
        )
    })

    it('colors creates green, updates yellow, deletes red, and the unchanged count dim', () => {
        const plan = mkPlan({
            create: [{ relPath: 'a.md', size: 1, absPath: '/x/a.md' }],
            update: [
                {
                    relPath: 'b.md',
                    size: 2,
                    absPath: '/x/b.md',
                    sourceId: 'src_b'
                }
            ],
            del: [{ sourceId: 'src_c', name: 'c.md' }],
            unchanged: 1
        })
        const rendered = renderPlan(plan, paint(true))
        const summaryLine = rendered.split('\n')[0]
        expect(summaryLine).toContain('\x1b[32m+1 created\x1b[0m')
        expect(summaryLine).toContain('\x1b[33m~1 updated\x1b[0m')
        expect(summaryLine).toContain('\x1b[31m−1 deleted\x1b[0m')
        expect(summaryLine).toContain('\x1b[2m(1 unchanged)\x1b[0m')

        const lines = rendered.split('\n')
        expect(lines).toContain('\x1b[32m  + a.md\x1b[0m')
        expect(lines).toContain('\x1b[33m  ~ b.md\x1b[0m')
        expect(lines).toContain('\x1b[31m  − c.md\x1b[0m')
    })
})
