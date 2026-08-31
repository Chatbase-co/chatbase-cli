import fs from 'node:fs'
import path from 'node:path'
import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import type { BaseFlags } from '../../base/base-command.js'
import { listAllSources } from '../../base/sources.js'
import { filesHostMismatchWarning } from '../../client/files.js'

import { resolveApiKey } from '../../config/resolve.js'
import { UsageError } from '../../errors/errors.js'
import type { Palette } from '../../output/color.js'
import { computeSyncPlan, type LocalFile, scanDir } from '../../sync/diff.js'
import { executeSyncPlan } from '../../sync/execute.js'
import { acquireSyncLock } from '../../sync/lock.js'
import { renderPlan } from '../../sync/render.js'

type SyncFlags = BaseFlags & {
    agent?: string
    'dry-run'?: boolean
    force?: boolean
    include?: string[]
    exclude?: string[]
}

// The upload API's documented size bounds — anything outside them is
// rejected server-side ("File size must be between 50 bytes and 20 MB"),
// so the plan skips those files up front with a note instead of burning a
// round trip on a guaranteed failure.
const MIN_UPLOAD_BYTES = 50
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024

/** Throws a UsageError (never touches the network) unless `dir` exists and
 * is a directory — mirrors `sources create`'s assertFileReadable, so a bad
 * local path fails fast instead of after an agent lookup / sources list
 * round trip. */
function assertDirReadable(dir: string): void {
    let stat: fs.Stats
    try {
        stat = fs.statSync(dir)
    } catch (err) {
        const code = (err as NodeJS.ErrnoException)?.code
        if (code === 'ENOENT') {
            throw new UsageError(`Directory not found: ${dir}`)
        }
        // EACCES, ENOTDIR, ...: the path may well exist — saying "not
        // found" would send the user hunting for the wrong problem.
        throw new UsageError(
            `Cannot read directory: ${dir} (${code ?? (err as Error)?.message})`
        )
    }
    if (!stat.isDirectory()) {
        throw new UsageError(`Not a directory: ${dir}`)
    }
}

function resolveSyncDir(positional: string | undefined): string {
    if (positional) return path.resolve(positional)
    throw new UsageError(
        'No directory specified. Pass one, e.g. `chatbase sources sync ./docs`.'
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
        const dir = resolveSyncDir(args.dir)
        assertDirReadable(dir)
        const include = flags.include
        const exclude = flags.exclude

        // Local scan is pure filesystem work — do it before any network
        // call so a bad tree (permission errors, etc.) fails fast.
        const local = scanDir(dir, { include, exclude })

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        // Dry-run performs no writes, so it never contends for the lock —
        // and must not fail just because a real sync is mid-flight.
        const releaseLock = flags['dry-run']
            ? () => {}
            : await acquireSyncLock(dir, agentId)
        try {
            await this.runPlan(flags, client, agentId, dir, local, {
                include,
                exclude
            })
        } finally {
            releaseLock()
        }
    }

    private async runPlan(
        flags: SyncFlags,
        client: ReturnType<AgentCommand['apiClient']>,
        agentId: string,
        _dir: string,
        local: LocalFile[],
        scanOpts: { include?: string[]; exclude?: string[] }
    ): Promise<void> {
        const remote = await listAllSources(client, agentId)
        // The FULL scan feeds the diff (so a size-skipped file still counts
        // as "present locally" and its remote source is never deleted); the
        // upload buckets are then filtered down to what the API accepts.
        const plan = computeSyncPlan(local, remote, scanOpts)
        const color = this.palette(flags)

        // Sync is all file uploads — surface the cross-environment files
        // host trap before doing (or planning) any of them.
        const mismatch = filesHostMismatchWarning()
        if (mismatch) this.note(flags, color.yellow(mismatch))

        const inBounds = (f: LocalFile): boolean =>
            f.size >= MIN_UPLOAD_BYTES && f.size <= MAX_UPLOAD_BYTES
        for (const f of [...plan.create, ...plan.update]) {
            if (inBounds(f)) continue
            const reason =
                f.size < MIN_UPLOAD_BYTES
                    ? `under the ${MIN_UPLOAD_BYTES}-byte upload minimum`
                    : 'over the 20 MB upload maximum'
            this.note(flags, color.yellow(`! skipped ${f.relPath} — ${reason}`))
        }
        plan.create = plan.create.filter(inBounds)
        plan.update = plan.update.filter(inBounds)

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

        // remoteFileCount derives from the plan itself: every IN-SCOPE
        // remote FILE source ends up matched (update/unchanged) or unmatched
        // (del) — out-of-scope sources fall out of all three buckets, so the
        // high-risk denominator counts only what this sync can touch.
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
            verbose: flags.verbose,
            onProgress: (line) =>
                this.note(flags, colorizeProgress(line, color))
        })

        // Each failure already printed inline as it happened (onProgress) —
        // re-listing them here would just double the noise.
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
