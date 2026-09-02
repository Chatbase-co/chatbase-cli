#!/usr/bin/env node
/**
 * Triage tool: compare every (method, path) in spec/openapi.json against
 * literal path usage in src/ (excluding src/generated/, which contains all
 * spec paths by definition).
 *
 * Run from the repo root:  node .claude/skills/spec-sync/scripts/coverage.mjs
 *
 * Tiers:
 *   missing  — no client call and no path literal found: likely needs a
 *              command (or an entry in spec/coverage-ignore.json)
 *   verify   — the path literal exists but not adjacent to a .METHOD( call
 *              (e.g. a path chosen via a variable): confirm by hand
 *   orphaned — a spec-shaped path literal in src/ that is not in the spec:
 *              stale code, usually from a removed/renamed endpoint
 *
 * This is a heuristic triage tool, not a gate — the authoritative sync
 * check between spec and generated types is `npm run spec:check`.
 */
import fs from 'node:fs'
import path from 'node:path'

const METHODS = ['get', 'post', 'put', 'patch', 'delete']

if (!fs.existsSync('spec/openapi.json')) {
    console.error('spec/openapi.json not found — run from the repo root.')
    process.exit(2)
}
const spec = JSON.parse(fs.readFileSync('spec/openapi.json', 'utf8'))

const files = []
;(function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (path.basename(p) !== 'generated') walk(p)
        } else if (p.endsWith('.ts')) {
            files.push(p)
        }
    }
})('src')
const src = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n')

const IGNORE_FILE = 'spec/coverage-ignore.json'
const ignored = fs.existsSync(IGNORE_FILE)
    ? JSON.parse(fs.readFileSync(IGNORE_FILE, 'utf8'))
    : []
const isIgnored = (method, p) =>
    ignored.some((e) => e.method?.toUpperCase() === method && e.path === p)

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hasLiteral = (p) => src.includes(`'${p}'`) || src.includes(`"${p}"`)

const missing = []
const verify = []
const ignoredHits = []
for (const [p, item] of Object.entries(spec.paths)) {
    for (const method of Object.keys(item)) {
        if (!METHODS.includes(method)) continue
        const M = method.toUpperCase()
        if (isIgnored(M, p)) {
            ignoredHits.push(`${M} ${p}`)
            continue
        }
        const adjacentCall = new RegExp(`\\.${M}\\(\\s*['"]${escapeRe(p)}['"]`)
        if (adjacentCall.test(src)) continue
        if (hasLiteral(p)) verify.push(`${M} ${p}`)
        else missing.push(`${M} ${p}`)
    }
}

// Orphans: quoted literals in src/ that look like spec paths but aren't in
// the spec any more. Scoped to the spec's own top-level segments so command
// help text and unrelated strings don't false-positive.
const topSegments = new Set(
    Object.keys(spec.paths).map((p) => p.split('/')[1])
)
const specPaths = new Set(Object.keys(spec.paths))
const orphans = new Set()
for (const m of src.matchAll(/['"](\/[a-zA-Z0-9_{}/-]+)['"]/g)) {
    const p = m[1]
    if (topSegments.has(p.split('/')[1]) && !specPaths.has(p)) orphans.add(p)
}

const section = (title, items, note) => {
    console.log(`\n${title}${items.length ? '' : ' (none)'}`)
    for (const i of items) console.log(`  ${i}`)
    if (items.length && note) console.log(`  → ${note}`)
}

section(
    'Missing — in spec, no dedicated command:',
    missing,
    'design a command or record the skip in spec/coverage-ignore.json'
)
section(
    'Verify manually — path literal present, method call not adjacent:',
    verify,
    'open the file and confirm the method is actually exercised'
)
section(
    'Orphaned — path literal in src/, not in spec:',
    [...orphans].sort(),
    'stale code from a removed or renamed endpoint'
)
if (ignoredHits.length)
    section('Ignored via spec/coverage-ignore.json:', ignoredHits)
