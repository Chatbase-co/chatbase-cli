import fs from 'node:fs'
import path from 'node:path'
import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import type { BaseFlags } from '../../base/base-command.js'
import { listAllSources } from '../../base/sources.js'
import { findProjectConfig, type ProjectConfig } from '../../config/project.js'
import { resolveApiKey } from '../../config/resolve.js'
import { UsageError } from '../../errors/errors.js'
import type { Palette } from '../../output/color.js'
import { computeSyncPlan, scanDir } from '../../sync/diff.js'
import { executeSyncPlan } from '../../sync/execute.js'
import { renderPlan } from '../../sync/render.js'

type SyncFlags = BaseFlags & {
    agent?: string
    'dry-run'?: boolean
    force?: boolean
    include?: string[]
    exclude?: string[]
}

/** Throws a UsageError (never touches the network) unless `dir` exists and
 * is a directory — mirrors `sources create`'s assertFileReadable, so a bad
 * local path fails fast instead of after an agent lookup / sources list
 * round trip. */
function assertDirReadable(dir: string): void {
    let stat: fs.Stats
    try {
        stat = fs.statSync(dir)
    } catch {
        throw new UsageError(`Directory not found: ${dir}`)
    }
    if (!stat.isDirectory()) {
        throw new UsageError(`Not a directory: ${dir}`)
    }
}

/**
 * Resolution chain for the directory to sync: positional arg > chatbase.json
 * `sync.dir` (resolved RELATIVE TO the chatbase.json file's own directory,
 * not the current working directory — a project file committed at a repo's
 * root must keep pointing at the same folder no matter which subdirectory a
 * command happens to be run from) > UsageError.
 */
function resolveSyncDir(
    positional: string | undefined,
    project: ProjectConfig | undefined
): string {
    if (positional) return path.resolve(positional)
    if (project?.sync?.dir) {
        return path.resolve(path.dirname(project.path), project.sync.dir)
    }
    throw new UsageError(
        'No directory specified. Pass one, e.g. `chatbase sources sync ./docs`, or set "sync.dir" in chatbase.json.'
    )
}

/** Colors one executeSyncPlan progress line by its leading glyph, mirroring renderPlan's palette. */
function colorizeProgress(line: string, color: Palette): string {
    if (line.startsWith('✗')) return color.red(line)
    if (line.startsWith('+')) return color.green(line)
    if (line.startsWith('~')) return color.yellow(line)
    if (line.startsWith('−')) return color.red(line)
    return line
}

export default class SourcesSync extends AgentCommand {
    static override description =
        "Converge an agent's file sources to match a local directory (create/update/delete)"
    static override examples = [
        '<%= config.bin %> sources sync ./docs -a agt_123',
        '<%= config.bin %> sources sync ./docs --dry-run',
        '<%= config.bin %> sources sync ./docs --force'
    ]
    static override args = {
        dir: Args.string({
            required: false,
            description:
                'Local directory to sync (else chatbase.json "sync.dir")'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        'dry-run': Flags.boolean({
            char: 'n',
            description: 'Show the plan without applying it'
        }),
        force: Flags.boolean({
            description: 'Apply without any confirmation prompt'
        }),
        include: Flags.string({
            multiple: true,
            description:
                'Glob(s) of files to include (repeatable); overrides defaults and chatbase.json'
        }),
        exclude: Flags.string({
            multiple: true,
            description:
                'Glob(s) of files to exclude (repeatable); overrides defaults and chatbase.json'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesSync)
        const project = findProjectConfig()
        const dir = resolveSyncDir(args.dir, project)
        assertDirReadable(dir)
        const include = flags.include ?? project?.sync?.include
        const exclude = flags.exclude ?? project?.sync?.exclude

        // Local scan is pure filesystem work — do it before any network
        // call so a bad tree (permission errors, etc.) fails fast.
        const local = scanDir(dir, { include, exclude })

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const remote = await listAllSources(client, agentId)
        const plan = computeSyncPlan(local, remote)
        const color = this.palette(flags)

        if (plan.caseCollisions.length > 0) {
            this.note(
                flags,
                color.yellow(
                    `! Case-insensitive filename collision${plan.caseCollisions.length > 1 ? 's' : ''} (these would clobber each other on a case-insensitive filesystem): ${plan.caseCollisions.join(', ')}`
                )
            )
        }

        this.note(flags, renderPlan(plan, color))

        if (flags['dry-run']) return

        // remoteFileCount derives from the plan itself: every remote FILE
        // source ends up matched (update/unchanged) or unmatched (del) —
        // no second pass over `remote` needed.
        const remoteFileCount =
            plan.unchanged + plan.update.length + plan.del.length
        const highRisk = plan.del.length > 0.5 * remoteFileCount
        const totalChanges =
            plan.create.length + plan.update.length + plan.del.length

        // Nothing to confirm for a no-op plan — prompting (or refusing
        // non-interactively without --force) would otherwise turn an
        // already-converged CI run into a false failure.
        if (totalChanges > 0) {
            await this.confirmSync(flags, agentId, plan.del.length, highRisk)
        }

        const resolvedKey = resolveApiKey()
        if (!resolvedKey) {
            // Unreachable in practice: this.apiClient() above already
            // required auth and would have thrown first.
            throw new UsageError(
                'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
            )
        }

        const result = await executeSyncPlan(plan, {
            agentId,
            apiKey: resolvedKey.value,
            client,
            onProgress: (line) =>
                this.note(flags, colorizeProgress(line, color))
        })

        if (result.failures.length > 0) {
            this.note(flags, color.red(`Failures (${result.failures.length}):`))
            for (const f of result.failures) {
                this.note(flags, color.red(`  ✗ ${f.name}: ${f.error}`))
            }
        }

        const summary = `Synced: +${plan.create.length} ~${plan.update.length} −${plan.del.length} (${plan.unchanged} unchanged)`
        if (result.failures.length > 0) {
            this.note(flags, `${color.red('✗')} ${summary}`)
            this.exit(1)
        } else {
            this.success(flags, summary)
        }
    }

    /**
     * Confirmation gate before executeSyncPlan runs. `--force` skips this
     * entirely. Otherwise: a TTY gets a y/N prompt, escalated to a typed
     * agent-ID confirmation (mirroring `agents delete`) when the plan would
     * delete more than half of the agent's current file sources; anything
     * non-interactive (no TTY, or `--no-input`) is refused outright, with
     * the refusal naming the escalation tier it would have hit
     * interactively so a CI log explains itself without a human ever seeing
     * the prompt.
     */
    private async confirmSync(
        flags: SyncFlags,
        agentId: string,
        delCount: number,
        highRisk: boolean
    ): Promise<void> {
        if (flags.force) return

        if (!process.stdin.isTTY || flags['no-input']) {
            if (highRisk) {
                throw new UsageError(
                    `This sync would delete ${delCount} file source(s) — more than half of this agent's current file sources. ` +
                        'Interactively, this requires typing the agent ID to confirm; non-interactively, re-run with --force.'
                )
            }
            throw new UsageError(
                'Non-interactive session (no TTY, or --no-input) — re-run with --force to apply this sync plan.'
            )
        }

        if (highRisk) {
            const { input } = await import('@inquirer/prompts')
            const typed = await input({
                message: `This sync would delete ${delCount} file source(s) — more than half of this agent's current file sources. Type the agent ID (${agentId}) to confirm:`
            })
            if (typed.trim() !== agentId) {
                throw new UsageError('Confirmation did not match; aborted.')
            }
            return
        }

        const { confirm } = await import('@inquirer/prompts')
        const proceed = await confirm({
            message: `Apply this sync plan to agent ${agentId}?`,
            default: false
        })
        if (!proceed) throw new UsageError('Sync cancelled.')
    }
}
