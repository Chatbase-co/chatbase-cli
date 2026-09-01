import { Args } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import {
    resolveAgent,
    resolveTimeoutMs,
    resolveTimeoutSource
} from '../../config/resolve.js'
import { UsageError } from '../../errors/errors.js'

export default class ConfigGet extends BaseCommand {
    static override description =
        'Print a resolved CLI configuration value and where it comes from'
    static override examples = [
        '<%= config.bin %> config get agent',
        '<%= config.bin %> config get timeout'
    ]
    static override args = {
        key: Args.string({
            required: true,
            description: 'agent | timeout'
        })
    }
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConfigGet)
        const key = args.key.toLowerCase()

        if (key === 'agent') {
            const resolved = resolveAgent()
            if (!resolved) {
                this.note(flags, 'agent is not set.')
                return
            }
            process.stdout.write(`${resolved.value}\n`)
            this.note(flags, `(from ${resolved.source})`)
            return
        }

        if (key === 'timeout') {
            const value = resolveTimeoutMs()
            process.stdout.write(`${value}\n`)
            this.note(flags, `(from ${resolveTimeoutSource()})`)
            return
        }

        throw new UsageError(
            `Unknown config key "${args.key}". Valid keys: agent, timeout.`
        )
    }
}
