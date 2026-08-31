import fs from 'node:fs'
import path from 'node:path'
import { Command, Errors, Flags } from '@oclif/core'
import type { Client } from 'openapi-fetch'
import {
    createApiClient,
    DEFAULT_BASE_URL,
    resolveBaseUrl
} from '../client/client.js'
import { installSigintHandler, wasInterrupted } from '../client/signals.js'
import { logsDir } from '../config/paths.js'
import { resolveApiKey, resolveTimeoutMs } from '../config/resolve.js'
import { ApiError, formatApiError, UsageError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
import { colorEnabled, type Palette, paint } from '../output/color.js'
import { type OutputMode, selectMode } from '../output/mode.js'
import { type Column, renderPlain, renderTable } from '../output/render.js'

const ISSUES_URL = 'https://github.com/Chatbase-co/chatbase-cli/issues/new'

type CliError = Error & { oclif?: { exit?: number } }

/** True for parser/validation errors oclif itself raises (unknown flag, bad --limit, etc). */
function isCliError(err: unknown): err is CliError {
    if (err instanceof Errors.CLIError) return true
    const withOclif = err as { oclif?: { exit?: number } } | null | undefined
    return typeof withOclif?.oclif?.exit === 'number'
}

function isFetchFailure(err: unknown): boolean {
    return err instanceof TypeError && /fetch failed/i.test(err.message)
}

function networkErrorCode(err: unknown): string | undefined {
    const cause = (
        err as { cause?: { code?: string; errors?: { code?: string }[] } }
    ).cause
    return cause?.code ?? cause?.errors?.[0]?.code
}

/** True for fetch's AbortSignal.timeout() firing (a TimeoutError DOMException). */
function isTimeoutError(err: unknown): boolean {
    const e = err as { name?: string; message?: string } | null | undefined
    if (e?.name === 'TimeoutError') return true
    if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
        return /timeout/i.test(e?.message ?? '')
    }
    return false
}

export type ClassifiedError =
    | { kind: 'usage'; error: UsageError }
    | { kind: 'api'; error: ApiError }
    | { kind: 'cli'; error: CliError }
    | { kind: 'interrupted' }
    | { kind: 'timeout' }
    | { kind: 'network'; code?: string }
    | { kind: 'unexpected'; error: unknown }

export function classifyError(err: unknown): ClassifiedError {
    if (err instanceof UsageError) return { kind: 'usage', error: err }
    if (err instanceof ApiError) return { kind: 'api', error: err }
    if (isCliError(err)) return { kind: 'cli', error: err }
    if (isTimeoutError(err)) return { kind: 'timeout' }
    if (isFetchFailure(err))
        return { kind: 'network', code: networkErrorCode(err) }
    const name = (err as { name?: string } | null | undefined)?.name
    if (name === 'AbortError') {
        return wasInterrupted() ? { kind: 'interrupted' } : { kind: 'timeout' }
    }
    return { kind: 'unexpected', error: err }
}

export type BaseFlags = {
    json?: boolean
    plain?: boolean
    quiet?: boolean
    verbose?: boolean
    'no-input'?: boolean
    'no-color'?: boolean
}

/** -f key=value body fields — spread into the flags of commands that send a
 * JSON request body (not part of baseFlags: advertising -f on body-less
 * commands like `health` was just noise in --help). */
export const bodyFieldFlags = {
    field: Flags.string({
        char: 'f',
        multiple: true,
        description: 'Set a body field: -f key=value (repeatable)'
    })
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
            return
        }
        if (rows.length === 0) {
            this.note(flags, 'No results.')
            return
        }
        if (mode === 'plain') {
            process.stdout.write(`${renderPlain(rows, columns)}\n`)
        } else {
            process.stdout.write(`${renderTable(rows, columns)}\n`)
        }
    }

    protected printDetail(
        flags: BaseFlags,
        raw: unknown,
        row: Record<string, string>,
        columns: Column[],
        detail: Array<[string, string]>
    ): void {
        if (this.mode(flags) !== 'pretty') {
            this.printData(flags, raw, [row], columns)
            return
        }
        const shown = detail.filter(([, value]) => value !== '')
        const width = Math.max(...shown.map(([label]) => label.length))
        process.stdout.write(
            `${shown.map(([label, value]) => `${label.padEnd(width + 2)}${value}`).join('\n')}\n`
        )
    }

    protected apiClient(flags: BaseFlags): Client<paths> {
        const resolved = resolveApiKey()
        if (!resolved && this.requireAuth) {
            throw new UsageError(
                'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
            )
        }
        return createApiClient({
            apiKey: resolved?.value,
            verbose: flags.verbose
        })
    }

    override async catch(err: unknown): Promise<never> {
        const flags = {
            'no-color': process.argv.includes('--no-color')
        } as BaseFlags
        const classified = classifyError(err)

        if (classified.kind === 'usage') {
            process.stderr.write(`${classified.error.message}\n`)
            this.exit(2)
        }
        if (classified.kind === 'api') {
            if (process.argv.includes('--json')) {
                const { code, message, details, requestId, status } =
                    classified.error
                process.stderr.write(
                    `${JSON.stringify({ error: { code, message, details }, requestId, status }, null, 2)}\n`
                )
            } else {
                process.stderr.write(
                    `${formatApiError(classified.error, this.palette(flags))}\n`
                )
            }
            this.exit(1)
        }
        if (classified.kind === 'cli') {
            await super.catch(classified.error)
            this.exit(classified.error.oclif?.exit ?? 2)
        }
        if (classified.kind === 'interrupted') {
            this.exit(130)
        }
        if (classified.kind === 'timeout') {
            process.stderr.write(
                `✗ Request timed out after ${resolveTimeoutMs()}ms (set CHATBASE_TIMEOUT to change)\n`
            )
            this.exit(1)
        }
        if (classified.kind === 'network') {
            const base = resolveBaseUrl()
            process.stderr.write(
                `✗ Network error: could not reach ${base}${classified.code ? ` (${classified.code})` : ''}\n`
            )
            process.stderr.write(
                base === DEFAULT_BASE_URL
                    ? '  Check your internet connection and retry.\n'
                    : '  CHATBASE_API_URL is overriding the API base — check that value first.\n'
            )
            this.exit(1)
        }
        // Server returned HTML instead of JSON — usually a wrong base URL
        // hitting a web page instead of the API.
        const msg = (err as Error)?.message ?? ''
        if (
            err instanceof SyntaxError &&
            (msg.includes('<!DOCTYPE') || msg.includes('is not valid JSON'))
        ) {
            const base = resolveBaseUrl()
            process.stderr.write(
                `✗ The server returned an HTML page instead of JSON.\n` +
                    `  This usually means CHATBASE_API_URL is wrong or the endpoint doesn't exist on this host.\n` +
                    `  Current base: ${base}\n`
            )
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
