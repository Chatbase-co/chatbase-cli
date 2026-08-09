import { Flags } from '@oclif/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseCommand } from '../../src/base/base-command.js'
import { ApiError, UsageError } from '../../src/errors/errors.js'

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

    it('--quiet suppresses notes but not data', async () => {
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await Probe.run(['--quiet', '--plain'], process.cwd())
        expect(out.mock.calls.length).toBeGreaterThan(0)
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toBe('')
    })
})
