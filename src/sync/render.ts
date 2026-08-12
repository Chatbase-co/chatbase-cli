import type { Palette } from '../output/color.js'
import type { SyncPlan } from './diff.js'

/**
 * Renders a `SyncPlan` as a git-push style summary line, e.g.
 * `+3 created  ~2 updated  −1 deleted  (4 unchanged)`, followed by one line
 * per create/update/delete with a `+`/`~`/`−` prefix. Colored (green /
 * yellow / red / dim) via the supplied Palette; the caller is responsible
 * for choosing a color-enabled vs. plain Palette and for writing the result
 * to stderr.
 */
export function renderPlan(plan: SyncPlan, color: Palette): string {
    const summary = [
        color.green(`+${plan.create.length} created`),
        color.yellow(`~${plan.update.length} updated`),
        color.red(`−${plan.del.length} deleted`),
        color.dim(`(${plan.unchanged} unchanged)`)
    ].join('  ')

    const lines: string[] = [summary]
    for (const f of plan.create) lines.push(color.green(`  + ${f.relPath}`))
    for (const f of plan.update) lines.push(color.yellow(`  ~ ${f.relPath}`))
    for (const d of plan.del) lines.push(color.red(`  − ${d.name}`))
    return lines.join('\n')
}
