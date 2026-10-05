#!/usr/bin/env node
/**
 * Print what a command for one operation must handle, straight from the
 * spec: every parameter's constraints, body fields, nullable response
 * fields, error codes, and the operation description, which is where
 * paging quirks live. A step-6 proposal must account for every line.
 *
 *   node .claude/skills/spec-sync/scripts/operation.mjs GET /agents/{agentId}/conversations/search
 */
import fs from 'node:fs'

const [method, opPath] = process.argv.slice(2)
if (!method || !opPath) {
    console.error('usage: operation.mjs <METHOD> <path>')
    process.exit(2)
}
const spec = JSON.parse(fs.readFileSync('spec/openapi.json', 'utf8'))
const op = spec.paths[opPath]?.[method.toLowerCase()]
if (!op) {
    console.error(`${method.toUpperCase()} ${opPath} is not in the spec`)
    process.exit(2)
}

const deref = (s) => {
    while (s?.$ref) s = spec.components.schemas[s.$ref.split('/').pop()]
    if (s?.allOf) {
        const parts = s.allOf.map(deref)
        return {
            ...Object.assign({}, ...parts),
            properties: Object.assign({}, ...parts.map((p) => p.properties)),
            required: parts.flatMap((p) => p.required ?? [])
        }
    }
    return s
}
const constraints = (s) => {
    s = deref(s) ?? {}
    const out = [Array.isArray(s.type) ? s.type.join('|') : s.type]
    if (s.enum) out.push(`enum ${JSON.stringify(s.enum)}`)
    if (s.minimum !== undefined) out.push(`min ${s.minimum}`)
    if (s.maximum !== undefined) out.push(`max ${s.maximum}`)
    if (s.default !== undefined)
        out.push(`default ${JSON.stringify(s.default)}`)
    if (s.format) out.push(`format ${s.format}`)
    return out.filter(Boolean).join(', ')
}
const flags = (p, s) => {
    s = deref(s) ?? {}
    const notes = []
    // The traps that keep recurring in this API:
    if (
        s.type === 'string' &&
        s.enum?.every((v) => v === 'true' || v === 'false')
    )
        notes.push('BOOLEAN AS STRING ENUM: boolean flag, send the string')
    if (/comma-separated/i.test(p.description ?? ''))
        notes.push('COMMA-SEPARATED: plain string flag, say so in help')
    if (p.name === 'limit' && s.maximum !== undefined && s.maximum !== 100)
        notes.push(
            `LIMIT ≠ ListCommand's max 100: override the limit flag with max ${s.maximum}`
        )
    return notes.length ? `  ⚠ ${notes.join('; ')}` : ''
}

console.log(
    `${method.toUpperCase()} ${opPath}  (${op.operationId ?? 'no operationId'})`
)
if (op.description)
    console.log(
        `\nDescription (scan for paging, windows, caveats):\n  ${op.description}`
    )

console.log('\nParameters:')
for (const p of op.parameters ?? []) {
    console.log(
        `  ${p.in.padEnd(5)} ${p.name}${p.required ? ' *' : ''}: ${constraints(p.schema)}${flags(p, p.schema)}`
    )
    if (p.description) console.log(`        ${p.description}`)
}

const body = deref(op.requestBody?.content?.['application/json']?.schema)
if (body) {
    console.log(
        '\nBody fields (* required; a spec default makes it required in the generated type):'
    )
    for (const [k, v] of Object.entries(body.properties ?? {})) {
        console.log(
            `  ${k}${body.required?.includes(k) ? ' *' : ''}: ${constraints(v)}`
        )
    }
}

const ok = op.responses?.['200'] ?? op.responses?.['201']
let item = deref(ok?.content?.['application/json']?.schema)
if (deref(item?.properties?.data)?.type === 'array')
    item = deref(deref(item.properties.data).items)
if (item?.properties) {
    const nullable = Object.entries(item.properties)
        .filter(([, v]) => {
            const d = deref(v) ?? {}
            return (
                (Array.isArray(d.type) && d.type.includes('null')) ||
                d.nullable ||
                d.enum?.includes(null)
            )
        })
        .map(([k]) => k)
    if (nullable.length)
        console.log(
            `\nNullable response fields (render empty, never "null"): ${nullable.join(', ')}`
        )
    const epoch = Object.entries(item.properties)
        .filter(([, v]) => /epoch/i.test(deref(v)?.description ?? ''))
        .map(([k]) => k)
    if (epoch.length)
        console.log(
            `Epoch-second fields (format with formatEpochSeconds in pretty mode): ${epoch.join(', ')}`
        )
}

console.log(
    '\nError codes (add a REMEDIATIONS entry in src/errors/errors.ts when the fix is not obvious from the message):'
)
for (const [status, r] of Object.entries(op.responses ?? {})) {
    if (Number(status) < 400) continue
    const examples = r.content?.['application/json']?.examples ?? {}
    for (const [code, ex] of Object.entries(examples)) {
        console.log(`  ${status} ${code}: ${ex.summary ?? ''}`)
    }
}
