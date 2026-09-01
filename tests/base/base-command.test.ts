import { Flags } from '@oclif/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseCommand, classifyError } from '../../src/base/base-command.js'
import { ApiError, UsageError } from '../../src/errors/errors.js'

// classifyError() delegates to wasInterrupted() to tell an interrupted abort
// apart from a genuine timeout abort. Mock the module so tests can flip that
// without actually sending SIGINT to the test process.
let interrupted = false
vi.mock('../../src/client/signals.js', async (importOriginal) => {
    const actual =
        await importOriginal<typeof import('../../src/client/signals.js')>()
    return { ...actual, wasInterrupted: () => interrupted }
})

class Probe extends BaseCommand {
    static override flags = { ...BaseCommand.baseFlags, boom: Flags.string() }
    protected override requireAuth = false
    async run() {
        const { flags } = await this.parse(Probe)
        if (flags.boom === 'usage') throw new UsageError('bad usage')
        if (flags.boom === 'api')
            throw new ApiError({
                code: 'AUTH_INVALID_API_KEY',
                message: 'Invalid API key',
                status: 401,
                requestId: 'r1'
            })
        this.printData(
            flags,
            { data: [{ id: 'x1' }] },
            [{ id: 'x1' }],
            [{ key: 'id', header: 'ID' }]
        )
    }
}

describe('BaseCommand', () => {
    afterEach(() => vi.restoreAllMocks())

    it('routes data to stdout as JSON with --json', async () => {
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await Probe.run(['--json'], process.cwd())
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(JSON.parse(printed)).toEqual({ data: [{ id: 'x1' }] })
    })

    it('exits 2 on UsageError and 1 on ApiError, writing to stderr', async () => {
        const errWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Probe.run(['--boom', 'usage'], process.cwd())
        ).rejects.toMatchObject({
            oclif: { exit: 2 }
        })
        await expect(
            Probe.run(['--boom', 'api'], process.cwd())
        ).rejects.toMatchObject({
            oclif: { exit: 1 }
        })
        const stderr = errWrite.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('bad usage')
        expect(stderr).toContain('AUTH_INVALID_API_KEY')
        expect(stderr).toContain('request id: r1')
    })

    it('--json ApiError rendering includes requestId and status alongside the error envelope', async () => {
        // catch() sniffs the real process.argv for --json (it runs before
        // flags are parsed) rather than the argv passed to Probe.run(), so
        // the flag has to be on the actual process argv to take that branch.
        const originalArgv = process.argv
        process.argv = [...originalArgv, '--json']
        try {
            const errWrite = vi
                .spyOn(process.stderr, 'write')
                .mockReturnValue(true)
            await expect(
                Probe.run(['--boom', 'api'], process.cwd())
            ).rejects.toMatchObject({ oclif: { exit: 1 } })
            const stderr = errWrite.mock.calls.map((c) => String(c[0])).join('')
            expect(JSON.parse(stderr)).toEqual({
                error: {
                    code: 'AUTH_INVALID_API_KEY',
                    message: 'Invalid API key',
                    details: undefined
                },
                requestId: 'r1',
                status: 401
            })
        } finally {
            process.argv = originalArgv
        }
    })

    it('--quiet suppresses notes but not data', async () => {
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Probe.run(['--quiet', '--plain'], process.cwd())
        expect(out.mock.calls.length).toBeGreaterThan(0)
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toBe('')
    })

    it('rejects an unknown flag with oclif exit 2 and no bug-report URL', async () => {
        const errWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            Probe.run(['--totally-not-a-flag'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        const stderr = errWrite.mock.calls.map((c) => String(c[0])).join('')
        // A typo'd flag is the user's mistake, not ours — it must not be
        // routed through the "unexpected error" path that invites a bug report.
        expect(stderr).not.toContain('issues/new')
    })
})

describe('classifyError', () => {
    afterEach(() => {
        interrupted = false
        vi.restoreAllMocks()
    })

    it('classifies UsageError as kind "usage"', () => {
        const err = new UsageError('bad usage')
        expect(classifyError(err)).toEqual({ kind: 'usage', error: err })
    })

    it('classifies ApiError as kind "api"', () => {
        const err = new ApiError({
            code: 'SERVER_ERROR',
            message: 'boom',
            status: 500
        })
        expect(classifyError(err)).toEqual({ kind: 'api', error: err })
    })

    it('classifies a fetch timeout (AbortSignal.timeout) as kind "timeout"', () => {
        const err = {
            name: 'TimeoutError',
            message: 'The operation timed out.'
        }
        expect(classifyError(err)).toEqual({ kind: 'timeout' })
    })

    it('classifies an AbortError as "interrupted" when SIGINT fired', () => {
        interrupted = true
        const err = {
            name: 'AbortError',
            message: 'This operation was aborted'
        }
        expect(classifyError(err)).toEqual({ kind: 'interrupted' })
    })

    it('classifies an AbortError as "timeout" when no SIGINT fired', () => {
        interrupted = false
        const err = {
            name: 'AbortError',
            message: 'This operation was aborted'
        }
        expect(classifyError(err)).toEqual({ kind: 'timeout' })
    })

    it('classifies anything else as "unexpected"', () => {
        const err = new Error('something broke')
        expect(classifyError(err)).toEqual({ kind: 'unexpected', error: err })
    })

    it('classifies undici "fetch failed" as "network" with the cause code', () => {
        const err = Object.assign(new TypeError('fetch failed'), {
            cause: Object.assign(new Error('connect ECONNREFUSED'), {
                code: 'ECONNREFUSED'
            })
        })
        expect(classifyError(err)).toEqual({
            kind: 'network',
            code: 'ECONNREFUSED'
        })
    })

    it('digs the code out of an AggregateError cause', () => {
        const err = Object.assign(new TypeError('fetch failed'), {
            cause: new AggregateError([
                Object.assign(new Error('connect'), { code: 'ENOTFOUND' })
            ])
        })
        expect(classifyError(err)).toEqual({
            kind: 'network',
            code: 'ENOTFOUND'
        })
    })

    it('classifies a codeless fetch failure as "network" too', () => {
        expect(classifyError(new TypeError('fetch failed'))).toEqual({
            kind: 'network',
            code: undefined
        })
    })
})

describe('network failure presentation', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllEnvs()
    })

    class NetProbe extends BaseCommand {
        static override flags = { ...BaseCommand.baseFlags }
        protected override requireAuth = false
        async run() {
            throw Object.assign(new TypeError('fetch failed'), {
                cause: Object.assign(new Error('connect ECONNREFUSED'), {
                    code: 'ECONNREFUSED'
                })
            })
        }
    }

    it('prints a connectivity message, not a bug-report URL, and exits 1', async () => {
        const errWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(NetProbe.run([], process.cwd())).rejects.toMatchObject({
            oclif: { exit: 1 }
        })
        const stderr = errWrite.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('could not reach')
        expect(stderr).toContain('ECONNREFUSED')
        expect(stderr).not.toContain('issues/new')
    })

    it('points at CHATBASE_API_URL when the base is overridden', async () => {
        vi.stubEnv('CHATBASE_API_URL', 'http://localhost:9')
        const errWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(NetProbe.run([], process.cwd())).rejects.toMatchObject({
            oclif: { exit: 1 }
        })
        const stderr = errWrite.mock.calls.map((c) => String(c[0])).join('')
        expect(stderr).toContain('CHATBASE_API_URL')
        expect(stderr).toContain('http://localhost:9')
    })
})
