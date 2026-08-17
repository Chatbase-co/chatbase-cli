import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { SourceItem } from '../../src/base/sources.js'
import { computeSyncPlan, scanDir } from '../../src/sync/diff.js'

const rf = (
    name: string,
    size: number,
    type = 'file',
    id = `src_${name}`
): SourceItem => ({ id, type, name, size, status: 'trained' })

const lf = (relPath: string, size: number) => ({
    relPath,
    size,
    absPath: `/x/${relPath}`
})

function mkFixtureTree() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-diff-'))
    fs.mkdirSync(path.join(dir, 'docs'))
    fs.writeFileSync(path.join(dir, 'docs', 'guide.md'), '# guide')
    fs.writeFileSync(path.join(dir, 'report.pdf'), 'PDFDATA')
    fs.writeFileSync(path.join(dir, 'data.json'), '{}')
    fs.writeFileSync(path.join(dir, 'sheet.csv'), 'a,b\n1,2')
    fs.writeFileSync(path.join(dir, 'image.png'), 'binarydata')
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1')
    fs.mkdirSync(path.join(dir, '.hidden'))
    fs.writeFileSync(path.join(dir, '.hidden', 'file.md'), 'hidden')
    fs.mkdirSync(path.join(dir, 'node_modules', 'pkg'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'node_modules', 'pkg', 'readme.md'), 'nope')
    return dir
}

describe('computeSyncPlan', () => {
    it('creates local-only, deletes remote-only, updates size mismatches, skips matches', () => {
        const plan = computeSyncPlan(
            [lf('a.txt', 10), lf('b.txt', 20), lf('c.txt', 30)],
            [rf('b.txt', 20), rf('c.txt', 99), rf('gone.txt', 5)]
        )
        expect(plan.create.map((f) => f.relPath)).toEqual(['a.txt'])
        expect(plan.update.map((f) => f.relPath)).toEqual(['c.txt'])
        expect(plan.update[0].sourceId).toBe('src_c.txt')
        expect(plan.del.map((d) => d.name)).toEqual(['gone.txt'])
        expect(plan.del[0].sourceId).toBe('src_gone.txt')
        expect(plan.unchanged).toBe(1)
    })

    it('trusts originalSize over the extracted-text size when present', () => {
        // The API's `size` for file sources is the EXTRACTED TEXT size (46
        // here) — comparing it to raw bytes re-uploads every PDF forever.
        // originalSize is the raw upload size the server now exposes.
        const plan = computeSyncPlan(
            [lf('report.pdf', 620)],
            [{ ...rf('report.pdf', 46), originalSize: 620 }]
        )
        expect(plan.update).toEqual([])
        expect(plan.unchanged).toBe(1)
    })

    it('flags a real content change via originalSize', () => {
        const plan = computeSyncPlan(
            [lf('report.pdf', 999)],
            [{ ...rf('report.pdf', 46), originalSize: 620 }]
        )
        expect(plan.update.map((f) => f.relPath)).toEqual(['report.pdf'])
    })

    it('falls back to the extracted size when originalSize is null', () => {
        // Sources uploaded before the server recorded originalSize keep
        // today's over-eager behavior (may re-upload) — never under-report.
        const plan = computeSyncPlan(
            [lf('report.pdf', 620)],
            [{ ...rf('report.pdf', 46), originalSize: null }]
        )
        expect(plan.update.map((f) => f.relPath)).toEqual(['report.pdf'])
    })

    it('scopes the delete pass to the same include/exclude filters as the scan', () => {
        // With --include '**/*.pdf', other.txt was never scanned locally —
        // its remote source must NOT look like a removed file.
        const plan = computeSyncPlan(
            [],
            [rf('keep.pdf', 10), rf('other.txt', 10)],
            { include: ['**/*.pdf'] }
        )
        expect(plan.del.map((d) => d.name)).toEqual(['keep.pdf'])
    })

    it('by default only deletes remote sources whose type the sync can manage', () => {
        // legacy.md can't be uploaded by sync (the API rejects .md), so the
        // default filters must leave its remote source alone too.
        const plan = computeSyncPlan(
            [],
            [rf('legacy.md', 10), rf('gone.txt', 10)]
        )
        expect(plan.del.map((d) => d.name)).toEqual(['gone.txt'])
    })

    it('never touches non-file sources', () => {
        const plan = computeSyncPlan(
            [],
            [rf('faq', 1, 'qna'), rf('site', 1, 'link'), rf('note', 1, 'text')]
        )
        expect(plan.del).toEqual([])
        expect(plan.create).toEqual([])
        expect(plan.unchanged).toBe(0)
    })

    it('does not let a toBeDeleted/deleted remote source suppress the create of a same-named local file', () => {
        const toBeDeleted: SourceItem = {
            ...rf('a.md', 10),
            status: 'toBeDeleted'
        }
        const deleted: SourceItem = { ...rf('b.md', 20), status: 'deleted' }
        const plan = computeSyncPlan(
            [lf('a.md', 10), lf('b.md', 20)],
            [toBeDeleted, deleted]
        )
        expect(plan.create.map((f) => f.relPath)).toEqual(['a.md', 'b.md'])
        expect(plan.unchanged).toBe(0)
        expect(plan.del).toEqual([])
    })

    it('flags case-insensitive collisions among local files', () => {
        const plan = computeSyncPlan(
            [lf('Readme.md', 1), lf('readme.md', 2)],
            []
        )
        expect(plan.caseCollisions).toEqual(['readme.md'])
    })

    it('does not flag distinct relPaths as collisions', () => {
        const plan = computeSyncPlan([lf('a.md', 1), lf('b.md', 2)], [])
        expect(plan.caseCollisions).toEqual([])
    })

    it('returns an empty plan for no local files and no remote sources', () => {
        const plan = computeSyncPlan([], [])
        expect(plan).toEqual({
            create: [],
            update: [],
            del: [],
            unchanged: 0,
            caseCollisions: []
        })
    })
})

describe('scanDir', () => {
    it('returns only files matching the default include globs, with size and relPath', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir)
        const byRelPath = Object.fromEntries(
            files.map((f) => [f.relPath, f.size])
        )
        // Defaults track the upload API's allowed types (.pdf .docx .doc
        // .txt .json) — .md/.html/.csv are rejected server-side, so scanning
        // them by default guarantees failed uploads.
        expect(Object.keys(byRelPath).sort()).toEqual([
            'data.json',
            'report.pdf'
        ])
        expect(byRelPath['data.json']).toBe('{}'.length)
        expect(byRelPath['report.pdf']).toBe('PDFDATA'.length)
    })

    it('excludes dotfiles and dot-directories even when the extension matches', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir)
        expect(files.map((f) => f.relPath)).not.toContain('.hidden/file.md')
        expect(files.map((f) => f.relPath)).not.toContain('.env')
    })

    it('excludes node_modules', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir)
        expect(files.map((f) => f.relPath)).not.toContain(
            'node_modules/pkg/readme.md'
        )
    })

    it('produces absPath values that resolve back to the same file', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir)
        const report = files.find((f) => f.relPath === 'report.pdf')
        expect(report?.absPath).toBe(path.join(dir, 'report.pdf'))
    })

    it('always uses forward slashes in relPath', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir)
        for (const f of files) {
            expect(f.relPath).not.toContain('\\')
        }
    })

    it('honors a custom include list, ignoring the defaults', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir, { include: ['**/*.png'] })
        expect(files.map((f) => f.relPath)).toEqual(['image.png'])
    })

    it('replaces the default exclude entirely when a custom exclude is given', () => {
        const dir = mkFixtureTree()
        const files = scanDir(dir, {
            include: ['**/*.md'],
            exclude: ['**/docs/**']
        })
        // docs/guide.md is excluded by the custom pattern, but the defaults
        // (dotfiles, node_modules) no longer apply once exclude is overridden.
        expect(files.map((f) => f.relPath).sort()).toEqual([
            '.hidden/file.md',
            'node_modules/pkg/readme.md'
        ])
    })

    it('returns an empty array for a directory with no matching files', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-empty-'))
        expect(scanDir(dir)).toEqual([])
    })

    it('treats "?" as exactly one character, not a regex quantifier', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-sync-glob-'))
        fs.writeFileSync(path.join(dir, 'file.docx'), 'x')
        fs.writeFileSync(path.join(dir, 'file.doc'), 'x')
        const files = scanDir(dir, { include: ['*.doc?'] })
        expect(files.map((f) => f.relPath)).toEqual(['file.docx'])
    })
})
