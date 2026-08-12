import { BaseCommand } from '../../base/base-command.js'
import {
    resolveAgent,
    resolveTimeoutMs,
    resolveTimeoutSource
} from '../../config/resolve.js'

export default class ConfigList extends BaseCommand {
    static override description =
        'List every resolved CLI configuration value and its source'
    static override examples = ['<%= config.bin %> config list']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(ConfigList)

        const agent = resolveAgent(undefined, process.cwd())
        this.note(
            flags,
            `agent    ${agent ? agent.value : '<not set>'}  (from ${agent ? agent.source : 'default'})`
        )

        const timeoutMs = resolveTimeoutMs()
        this.note(
            flags,
            `timeout  ${timeoutMs}ms  (from ${resolveTimeoutSource()})`
        )
    }
}
