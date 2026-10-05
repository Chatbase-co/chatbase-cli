#!/usr/bin/env node
/**
 * Contract check: compare each command's flags with the spec operation it
 * calls. Where coverage.mjs asks whether an endpoint has a command, this asks
 * whether the command still matches the endpoint. The type checker can't see
 * either kind of drift, because oclif flag metadata isn't typed against the
 * spec.
 *
 * Run from the repo root after `npm run build`, because it imports the
 * compiled commands to read their real flag metadata, base flags included:
 *   node .claude/skills/spec-sync/scripts/contract.mjs [--json] [--spec <file>]
 *
 * Findings:
 *   error   a flag accepts values the API rejects, or rejects values it
 *           accepts: integer bounds wider/narrower than the spec, or enum
 *           options that differ from the spec enum
 *   warn    a required query param no flag maps to, a flag with no bounds
 *           where the spec has them, or a row mapper reading a field that is
 *           not on the response item (most rows read Record<string, unknown>,
 *           so tsc can't catch a renamed response field)
 *   info    optional query params or body fields no flag exposes (often
 *           deliberate; `-f/--field` and `chatbase api` still reach them)
 *
 * Not checked here, because `npm run typecheck` already catches it: missing
 * required body fields, renamed body fields, and wrong path params.
 *
 * Mapping a flag to a param is heuristic: the kebab-case name matches
 * (`user-id` ↔ `userId`), or the source assigns `param: flags.x`,
 * `.param = flags['x']`, or maps `'x': 'param'`. A mapping it misses shows
 * up as an info/warn line. Open the command before acting on any finding.
 * Exit code is 1 if there are errors, so this can gate CI.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const specPath = argv.includes('--spec')
    ? argv[argv.indexOf('--spec') + 1]
    : 'spec/openapi.json'
for (const need of [specPath, 'dist/commands']) {
    if (!fs.existsSync(need)) {
        console.error(
            `${need} not found. Run from the repo root after npm run build.`
        )
        process.exit(2)
    }
}
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'))
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

const deref = (s, seen = new Set()) => {
    if (!s || typeof s !== 'object') return s
    if (s.$ref) {
        if (seen.has(s.$ref)) return {}
        seen.add(s.$ref)
        const name = s.$ref.split('/').pop()
        return deref(spec.components.schemas[name], seen)
    }
    if (s.allOf) {
        const merged = { type: 'object', properties: {}, required: [] }
        for (const part of s.allOf.map((p) => deref(p, seen))) {
            Object.assign(merged.properties, part.properties ?? {})
            merged.required.push(...(part.required ?? []))
        }
        return merged
    }
    return s
}
const objectProps = (s) => {
    s = deref(s)
    if (!s) return { props: {}, required: [] }
    // oneOf/anyOf bodies: union of every branch's properties
    const branches = s.oneOf ?? s.anyOf
    if (branches) {
        const out = { props: {}, required: [] }
        for (const b of branches.map((x) => objectProps(x))) {
            for (const [k, v] of Object.entries(b.props)) {
                const prev = deref(out.props[k])
                const cur = deref(v)
                // Discriminators like `type` carry one enum value per branch
                if (prev?.enum && cur?.enum) {
                    out.props[k] = {
                        ...cur,
                        enum: [...new Set([...prev.enum, ...cur.enum])]
                    }
                } else out.props[k] = v
            }
        }
        return out
    }
    return { props: s.properties ?? {}, required: s.required ?? [] }
}

const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const commandFiles = []
;(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (p.endsWith('.ts')) commandFiles.push(p)
    }
})('src/commands')

const findings = []
const noEndpoint = []
const add = (level, cmd, op, msg) => findings.push({ level, cmd, op, msg })

for (const file of commandFiles.sort()) {
    const src = fs.readFileSync(file, 'utf8')
    // path.relative + split keeps this working with Windows separators
    const rel = path.relative('src/commands', file).split(path.sep)
    const cmd = rel.join(' ').replace(/( index)?\.ts$/, '')

    // Endpoints: `.METHOD(\n '/path'` calls, plus bare spec-path literals
    // (paths chosen through a variable) resolved to every method the spec
    // has for them.
    const ops = new Map()
    for (const m of src.matchAll(
        /\.(GET|POST|PUT|PATCH|DELETE)\(\s*['"](\/[^'"]+)['"]/g
    )) {
        ops.set(`${m[1]} ${m[2]}`, [m[1], m[2]])
    }
    if (ops.size === 0) {
        for (const m of src.matchAll(/['"](\/[a-zA-Z0-9_{}/-]+)['"]/g)) {
            const item = spec.paths[m[1]]
            if (!item) continue
            for (const M of METHODS) {
                if (item[M.toLowerCase()]) ops.set(`${M} ${m[1]}`, [M, m[1]])
            }
        }
    }
    if (ops.size === 0) {
        noEndpoint.push(cmd)
        continue
    }

    const mod = await import(
        pathToFileURL(
            path.resolve('dist/commands', ...rel).replace(/\.ts$/, '.js')
        ).href
    )
    const flags = mod.default?.flags ?? {}
    const flagNames = Object.keys(flags)
    const argNames = Object.keys(mod.default?.args ?? {})

    const mapsTo = (param) => {
        const direct = kebab(param)
        if (flags[direct]) return direct
        for (const f of flagNames) {
            const access = `flags(?:\\.${escapeRe(camel(f))}|\\.${escapeRe(f)}|\\[['"]${escapeRe(f)}['"]\\])`
            const assigns = new RegExp(
                `\\b${escapeRe(param)}\\s*[:=]\\s*(?:[^,;\\n]*?)${access}`
            )
            const table = new RegExp(
                `['"]?${escapeRe(f)}['"]?\\s*:\\s*['"]${escapeRe(param)}['"]`
            )
            if (assigns.test(src) || table.test(src)) return f
        }
        // Positional args (`tickets search QUERY`) have no bounds or
        // options to compare; finding the mapping just silences the line.
        for (const a of argNames) {
            if (
                a === param ||
                new RegExp(
                    `\\b${escapeRe(param)}\\s*[:=][^,;\\n]*?args\\.${escapeRe(a)}\\b`
                ).test(src)
            )
                return `<${a}>`
        }
        return null
    }

    const compare = (opKey, name, schema, flagName) => {
        const s = deref(schema) ?? {}
        const flag = flags[flagName]
        if (!flag) return
        const where = `--${flagName} ↔ ${name}`
        const isInt = s.type === 'integer' || s.type === 'number'
        if (isInt && flag.type === 'option') {
            if (s.maximum !== undefined) {
                if (flag.max === undefined)
                    add(
                        'warn',
                        cmd,
                        opKey,
                        `${where}: spec max ${s.maximum}, flag unbounded`
                    )
                else if (flag.max !== s.maximum)
                    add(
                        'error',
                        cmd,
                        opKey,
                        `${where}: flag max ${flag.max}, spec max ${s.maximum}`
                    )
            }
            if (
                s.minimum !== undefined &&
                flag.min !== undefined &&
                flag.min !== s.minimum
            ) {
                add(
                    'error',
                    cmd,
                    opKey,
                    `${where}: flag min ${flag.min}, spec min ${s.minimum}`
                )
            }
        }
        const specEnum = (s.enum ?? s.items?.enum)?.filter((v) => v !== null)
        // Boolean flags sent as "true"/"false" string enums are fine.
        if (specEnum && flag.type === 'option' && !isInt) {
            const opts = flag.options
            if (!opts) {
                // A single-valued enum behind a free-text flag skips local
                // validation; fine when the server message is clear.
                add(
                    'info',
                    cmd,
                    opKey,
                    `${where}: spec enum (${specEnum.length > 6 ? `${specEnum.length} values` : specEnum.join(', ')}), flag accepts any string`
                )
                return
            }
            const extra = opts.filter((o) => !specEnum.includes(o))
            const missing = specEnum.filter((v) => !opts.includes(String(v)))
            if (extra.length)
                add(
                    'error',
                    cmd,
                    opKey,
                    `${where}: flag allows ${extra.join(', ')}, not in spec enum`
                )
            if (missing.length)
                add(
                    'error',
                    cmd,
                    opKey,
                    `${where}: spec allows ${missing.join(', ')}, flag options omit it`
                )
        }
    }

    for (const [opKey, [M, p]] of ops) {
        const op = spec.paths[p]?.[M.toLowerCase()]
        if (!op) {
            add('error', cmd, opKey, 'operation not in spec (orphaned call)')
            continue
        }
        for (const prm of op.parameters ?? []) {
            if (prm.in !== 'query') continue
            const f = mapsTo(prm.name)
            if (f) compare(opKey, prm.name, prm.schema, f)
            else
                add(
                    prm.required ? 'warn' : 'info',
                    cmd,
                    opKey,
                    `query ${prm.name}${prm.required ? ' (required)' : ''} not exposed by any flag`
                )
        }
        const bodySchema = op.requestBody?.content?.['application/json']?.schema
        if (bodySchema) {
            const { props, required } = objectProps(bodySchema)
            for (const [name, ps] of Object.entries(props)) {
                const f = mapsTo(name)
                if (f) compare(opKey, name, ps, f)
                // Required body fields are tsc's job: openapi-fetch types
                // every `body` against the spec.
                else if (!required.includes(name)) {
                    add(
                        'info',
                        cmd,
                        opKey,
                        `body ${name} not exposed by any flag`
                    )
                }
            }
        }
        // Response fields the row mapper reads (`.map((t) => ({ ... t.x }))`).
        // A renamed response field breaks these silently when the item is
        // typed as Record<string, unknown>, which most commands do.
        const ok = op.responses?.['200'] ?? op.responses?.['201']
        const res = deref(ok?.content?.['application/json']?.schema)
        if (res) {
            const arrays = Object.fromEntries(
                Object.entries(res.properties ?? {})
                    .map(([k, v]) => [k, deref(v)])
                    .filter(([, v]) => v?.type === 'array')
            )
            const names = Object.keys(arrays)
            // Pick the item schema from what `.map` is called on:
            // `result.templates.map(` → templates[], `items.map(` → data[]
            const itemFor = (receiver) => {
                if (res.type === 'array') return deref(res.items)
                if (arrays[receiver]) return deref(arrays[receiver].items)
                if (arrays.data) return deref(arrays.data.items)
                if (names.length === 1) return deref(arrays[names[0]].items)
                return res
            }
            for (const m of src.matchAll(
                /(\w+)\.map\(\(?(\w+)\)?\s*=>\s*\(\{([\s\S]*?)\}\)\)/g
            )) {
                const fields = new Set(
                    Object.keys(objectProps(itemFor(m[1])).props)
                )
                if (!fields.size) continue
                const reads = new Set(
                    [
                        ...m[3].matchAll(
                            new RegExp(`\\b${m[2]}\\??\\.(\\w+)`, 'g')
                        )
                    ].map((r) => r[1])
                )
                for (const r of reads) {
                    if (!fields.has(r))
                        add(
                            'warn',
                            cmd,
                            opKey,
                            `row mapper reads ${m[2]}.${r}, not a field on the response item`
                        )
                }
            }
        }
    }
}

if (asJson) {
    console.log(JSON.stringify({ findings, noEndpoint }, null, 2))
} else {
    for (const level of ['error', 'warn', 'info']) {
        const rows = findings.filter((f) => f.level === level)
        console.log(`\n${level.toUpperCase()} (${rows.length})`)
        for (const f of rows) console.log(`  ${f.cmd} [${f.op}]: ${f.msg}`)
    }
    if (noEndpoint.length) {
        console.log(
            `\nNo endpoint literal in the command file (helper module or local-only): ${noEndpoint.join(', ')}`
        )
    }
}
process.exit(findings.some((f) => f.level === 'error') ? 1 : 0)
