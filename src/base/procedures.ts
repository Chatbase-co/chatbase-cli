import { Flags } from '@oclif/core'
import { UsageError } from '../errors/errors.js'
import type { components } from '../generated/api.js'
import type { Column } from '../output/render.js'
import { readTextInput } from './body-input.js'

export type ProcedureStep = components['schemas']['ProcedureStep']

export const PROCEDURE_COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'status', header: 'STATUS' },
    { key: 'trigger', header: 'TRIGGER' },
    { key: 'unavailableActions', header: 'UNAVAILABLE ACTIONS' }
]

export const stepFlags = {
    steps: Flags.string({
        description:
            'Steps as a JSON array (@file, @-, or inline): {"kind":"instruction","text":"..."} or {"kind":"branch","branches":[{"condition","steps"}],"otherwise":{"steps"}}. Mention an action as @action_name. REPLACES all steps on update',
        exclusive: ['step']
    }),
    step: Flags.string({
        description:
            'One instruction step (repeatable, single line); shorthand for --steps without branches',
        multiple: true,
        exclusive: ['steps']
    })
}

/** Resolve --steps / --step into a steps array; undefined when neither is given. */
export async function readSteps(flags: {
    steps?: string
    step?: string[]
}): Promise<ProcedureStep[] | undefined> {
    if (flags.step?.length) {
        return flags.step.map((text) => ({ kind: 'instruction', text }))
    }
    if (flags.steps === undefined) return undefined
    let parsed: unknown
    try {
        parsed = JSON.parse(await readTextInput(flags.steps, '--steps'))
    } catch (err) {
        if (err instanceof UsageError) throw err
        throw new UsageError('--steps must be a valid JSON array.')
    }
    if (!Array.isArray(parsed)) {
        throw new UsageError('--steps must be a JSON array of steps.')
    }
    return parsed as ProcedureStep[]
}

export function procedureRow(p: {
    id: string
    name: string
    status: string
    trigger: string
    unavailableActions: string[]
}): Record<string, string> {
    return {
        id: p.id,
        name: p.name,
        status: p.status,
        trigger: p.trigger,
        unavailableActions: p.unavailableActions.join(', ')
    }
}

/** Indented outline of steps for `procedures get`. */
export function renderSteps(steps: ProcedureStep[], depth = 0): string[] {
    const pad = '  '.repeat(depth)
    const lines: string[] = []
    steps.forEach((s, i) => {
        if (s.kind === 'instruction') {
            lines.push(`${pad}${i + 1}. ${s.text}`)
            return
        }
        lines.push(`${pad}${i + 1}. Branch`)
        for (const b of s.branches) {
            lines.push(`${pad}  If ${b.condition}:`)
            lines.push(...renderSteps(b.steps, depth + 2))
        }
        if (s.otherwise) {
            lines.push(`${pad}  Otherwise:`)
            lines.push(...renderSteps(s.otherwise.steps, depth + 2))
        }
    })
    return lines
}
