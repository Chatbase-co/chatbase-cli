import fs from 'node:fs'
import path from 'node:path'
import type { SourceItem } from '../base/sources.js'

/** One file found on disk by scanDir, keyed for matching against SourceItem.name. */
export type LocalFile = { relPath: string; size: number; absPath: string }

/**
 * The result of diffing a local directory scan against the remote file
 * sources for an agent. Pure data — no I/O happens here, and `--force`
 * (re-upload everything) is a caller-level decision layered on top of this,
 * not something this type or computeSyncPlan needs to know about.
 */
export type SyncPlan = {
    create: LocalFile[]
    update: Array<LocalFile & { sourceId: string }>
    del: Array<{ sourceId: string; name: string }>
    unchanged: number
    caseCollisions: string[]
}

export type ScanOptions = { include?: string[]; exclude?: string[] }

// Only extensions the upload API accepts — it rejects everything else with
// "Unsupported file type. Allowed: .pdf, .docx, .doc, .txt, .json", so
// including more here (.md, .html, .csv, ...) guarantees failed uploads on
// every run. If the API grows support for a type, add it here too.
const DEFAULT_INCLUDE = [
    '**/*.pdf',
    '**/*.txt',
    '**/*.docx',
    '**/*.doc',
    '**/*.json'
]

const DEFAULT_EXCLUDE = ['**/.*', '**/.*/**', '**/node_modules/**']

const REGEXP_SPECIALS = new Set([
    '.',
    '+',
    '^',
    '$',
    '{',
    '}',
    '(',
    ')',
    '|',
    '[',
    ']',
    '\\'
])

/**
 * Glob → regex. Three wildcards:
 *   **​/  → any depth of directories (e.g. **​/*.md matches docs/a.md)
 *   *    → any chars within one directory (no slashes)
 *   ?    → exactly one character
 */
function globToRegExp(pattern: string): RegExp {
    let re = ''
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i]
        if (c === '*' && pattern[i + 1] === '*') {
            i++
            if (pattern[i + 1] === '/') {
                i++
                re += '(?:.*/)?'
            } else {
                re += '.*'
            }
        } else if (c === '*') {
            re += '[^/]*'
        } else if (c === '?') {
            re += '.'
        } else if (REGEXP_SPECIALS.has(c)) {
            re += `\\${c}`
        } else {
            re += c
        }
    }
    return new RegExp(`^${re}$`)
}

function matchGlob(pattern: string, relPath: string): boolean {
    return globToRegExp(pattern).test(relPath)
}

/** True if any file underneath `relPath` would be excluded anyway — used to prune node_modules/dot-directories during the walk instead of descending into them. */
function isDirPruned(relPath: string, exclude: string[]): boolean {
    const probe = `${relPath}/__probe__`
    return exclude.some((p) => matchGlob(p, probe))
}

/**
 * Recursively walks `dir`, returning every file whose path (relative to
 * `dir`, always `/`-separated regardless of OS) matches an include glob and
 * no exclude glob. Directories that would be fully excluded anyway
 * (node_modules, dotfiles) are pruned rather than descended into.
 */
export function scanDir(dir: string, opts: ScanOptions = {}): LocalFile[] {
    const include = opts.include ?? DEFAULT_INCLUDE
    const exclude = opts.exclude ?? DEFAULT_EXCLUDE
    const results: LocalFile[] = []

    function walk(current: string): void {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            const abs = path.join(current, entry.name)
            const relPath = path.relative(dir, abs).split(path.sep).join('/')
            if (entry.isDirectory()) {
                if (!isDirPruned(relPath, exclude)) walk(abs)
            } else if (entry.isFile()) {
                const included = include.some((p) => matchGlob(p, relPath))
                const excluded = exclude.some((p) => matchGlob(p, relPath))
                if (included && !excluded) {
                    results.push({
                        relPath,
                        size: fs.statSync(abs).size,
                        absPath: abs
                    })
                }
            }
        }
    }
    walk(dir)
    return results
}

/**
 * Diffs a local directory scan against the agent's remote sources. Only
 * `type === 'file'` remote items participate — qna/link/text sources have
 * no local counterpart and are left untouched. Sources already marked
 * `toBeDeleted` or `deleted` are excluded too, so a pending/completed remote
 * deletion doesn't get mistaken for a still-live match and suppress the
 * create of a local file with the same name. Matching is by exact
 * `name === relPath`; case-insensitive duplicates among the local files are
 * reported in `caseCollisions` (a warning, not an error — macOS's default
 * filesystem is case-insensitive so such a pair would silently clobber
 * itself, but Linux allows it) rather than blocking the diff.
 *
 * The delete pass is scoped by the SAME include/exclude filters the scan
 * used: a remote source only becomes a delete candidate if the filters
 * would have picked its local counterpart up. Otherwise `--include
 * '**\/*.pdf'` (or the default extension list) would delete every remote
 * source whose local file is still on disk but merely filtered out.
 */
export function computeSyncPlan(
    local: LocalFile[],
    remote: SourceItem[],
    opts: ScanOptions = {}
): SyncPlan {
    const include = opts.include ?? DEFAULT_INCLUDE
    const exclude = opts.exclude ?? DEFAULT_EXCLUDE
    const inScope = (name: string): boolean =>
        include.some((p) => matchGlob(p, name)) &&
        !exclude.some((p) => matchGlob(p, name))

    const remoteFiles = remote.filter(
        (r) =>
            r.type === 'file' &&
            r.status !== 'toBeDeleted' &&
            r.status !== 'deleted'
    )
    const remoteByName = new Map(remoteFiles.map((r) => [r.name, r]))
    const localRelPaths = new Set(local.map((l) => l.relPath))

    const lowerSeen = new Map<string, number>()
    const caseCollisions: string[] = []
    for (const l of local) {
        const lower = l.relPath.toLowerCase()
        const count = (lowerSeen.get(lower) ?? 0) + 1
        lowerSeen.set(lower, count)
        if (count === 2) caseCollisions.push(lower)
    }

    const create: LocalFile[] = []
    const update: Array<LocalFile & { sourceId: string }> = []
    let unchanged = 0
    for (const l of local) {
        const r = remoteByName.get(l.relPath)
        if (!r) {
            create.push(l)
            continue
        }
        // For file sources the remote `size` is the EXTRACTED TEXT size,
        // not the upload — comparing it to raw bytes marks every PDF/DOCX
        // as changed forever. Prefer originalSize (the raw upload size the
        // server records); fall back to the extracted size only when the
        // source predates that field, which over-reports but never misses
        // a change.
        const reference = r.originalSize ?? r.size
        if (reference !== l.size) {
            update.push({ ...l, sourceId: r.id })
        } else {
            unchanged++
        }
    }

    const del: Array<{ sourceId: string; name: string }> = []
    for (const r of remoteFiles) {
        if (!inScope(r.name)) continue
        if (!localRelPaths.has(r.name))
            del.push({ sourceId: r.id, name: r.name })
    }

    return { create, update, del, unchanged, caseCollisions }
}
