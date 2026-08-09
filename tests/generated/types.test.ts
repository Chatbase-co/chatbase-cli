import { describe, expect, it } from 'vitest'
import type { paths } from '../../src/generated/api.js'

// Compile-time assertions: if the spec loses these paths or shapes, tsc fails.
type HealthOp = paths['/health']['get']
type ListConvsOp = paths['/agents/{agentId}/conversations']['get']
type ListSourcesOp = paths['/agents/{agentId}/sources']['get']
type ListAgentsOp = paths['/agents']['get']

const healthHas200: HealthOp extends { responses: { 200: unknown } }
    ? true
    : false = true
const listTakesCursor: NonNullable<
    NonNullable<ListConvsOp['parameters']['query']>
> extends { cursor?: unknown }
    ? true
    : false = true
const sourcesPresent: ListSourcesOp extends { responses: { 200: unknown } }
    ? true
    : false = true
const agentsPresent: ListAgentsOp extends { responses: { 200: unknown } }
    ? true
    : false = true

describe('generated types', () => {
    it('cover the endpoints this plan builds on', () => {
        expect(healthHas200).toBe(true)
        expect(listTakesCursor).toBe(true)
        expect(sourcesPresent).toBe(true)
        expect(agentsPresent).toBe(true)
    })
})
