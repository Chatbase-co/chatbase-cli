import fs from 'node:fs'
import path from 'node:path'
import { Command, Flags } from '@oclif/core'
import type { Client } from 'openapi-fetch'
import { createApiClient } from '../client/client.js'
import { installSigintHandler } from '../client/signals.js'
import { logsDir } from '../config/paths.js'
import { resolveApiKey } from '../config/resolve.js'
import { ApiError, formatApiError, UsageError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
import { colorEnabled, type Palette, paint } from '../output/color.js'
import { type OutputMode, selectMode } from '../output/mode.js'
import { type Column, renderPlain, renderTable } from '../output/render.js'

const ISSUES_URL = 'https://github.com/Chatbase-co/chatbase-cli/issues/new'

type BaseFlags = {
    json?: boolean
    plain?: boolean
    quiet?: boolean
    verbose?: boolean
    'no-input'?: boolean
    'no-color'?: boolean
}

export abstract class BaseCommand extends Command {
    static baseFlags = {
        json: Flags.boolean({
            description: 'Output raw API JSON',
            helpGroup: 'OUTPUT'
        }),
        plain: Flags.boolean({
            description: 'Tab-separated output for scripts',
            helpGroup: 'OUTPUT'
        }),
        quiet: Flags.boolean({
            char: 'q',
            description: 'Suppress non-essential output'
        }),
        verbose: Flags.boolean({ description: 'Verbose diagnostics' }),
        'no-input': Flags.boolean({
            description: 'Never prompt; fail instead'
        }),
        'no-color': Flags.boolean({ description: 'Disable colored output' })
    }

    protected requireAuth = true

    override async init(): Promise<void> {
        await super.init()
        installSigintHandler()
    }

    protected mode(flags: BaseFlags): OutputMode {
        return selectMode(flags, process.stdout)
    }

    protected palette(flags: BaseFlags): Palette {
        return paint(colorEnabled(process.stderr, flags['no-color']))
    }

    protected note(flags: BaseFlags, msg: string): void {
        if (!flags.quiet) process.stderr.write(`${msg}\n`)
    }

    protected success(flags: BaseFlags, msg: string): void {
        this.note(flags, `${this.palette(flags).green('✓')} ${msg}`)
    }

    protected printData(
        flags: BaseFlags,
        raw: unknown,
        rows: Record<string, string>[],
        columns: Column[]
    ): void {
        const mode = this.mode(flags)
        if (mode === 'json') {
            process.stdout.write(`${JSON.stringify(raw, null, 2)}\n`)
        } else if (mode === 'plain') {
            if (rows.length > 0)
                process.stdout.write(`${renderPlain(rows, columns)}\n`)
        } else {
            process.stdout.write(`${renderTable(rows, columns)}\n`)
        }
    }

    protected apiClient(flags: BaseFlags): Client<paths> {
        const resolved = resolveApiKey()
        if (resolved?.warning)
            this.note(
                flags,
                this.palette(flags).yellow(`! ${resolved.warning}`)
            )
        if (!resolved && this.requireAuth) {
            throw new UsageError(
                'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
            )
        }
        return createApiClient({ apiKey: resolved?.value })
    }

    override async catch(err: unknown): Promise<never> {
        const flags = {} as BaseFlags
        if (err instanceof UsageError) {
            process.stderr.write(`${err.message}\n`)
            this.exit(2)
        }
        if (err instanceof ApiError) {
            if (process.argv.includes('--json')) {
                process.stderr.write(
                    `${JSON.stringify({ error: { code: err.code, message: err.message, details: err.details } }, null, 2)}\n`
                )
            } else {
                process.stderr.write(
                    `${formatApiError(err, this.palette(flags))}\n`
                )
            }
            this.exit(1)
        }
        // Unexpected: short message + full detail to a log file + pre-filled issue URL.
        const logFile = path.join(logsDir(), `error-${Date.now()}.log`)
        try {
            fs.mkdirSync(logsDir(), { recursive: true })
            fs.writeFileSync(logFile, String((err as Error)?.stack ?? err))
        } catch {
            /* logging must never mask the original failure */
        }
        const title = encodeURIComponent(
            `bug: ${(err as Error)?.message ?? 'unexpected error'}`
        )
        const body = encodeURIComponent(
            `CLI: chatbase ${this.config.version}\nOS: ${process.platform}-${process.arch}\nNode: ${process.versions.node}\nCommand: ${this.id}\n`
        )
        process.stderr.write(
            `✗ Unexpected error: ${(err as Error)?.message ?? err}\n`
        )
        process.stderr.write(`  details: ${logFile}\n`)
        process.stderr.write(
            `  report: ${ISSUES_URL}?title=${title}&body=${body}\n`
        )
        this.exit(1)
    }
}
