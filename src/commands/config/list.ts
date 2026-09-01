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

        const agent = resolveAgent()
        const timeoutMs = resolveTimeoutMs()

        const rows = [
            {
                key: 'agent',
                value: agent ? agent.value : '<not set>',
                source: agent ? agent.source : 'default'
            },
            {
                key: 'timeout',
                value: `${timeoutMs}ms`,
                source: resolveTimeoutSource()
            }
        ]

        this.printData(
            flags,
            rows,
            rows.map((r) => ({
                key: r.key,
                value: r.value,
                source: r.source
            })),
            [
                { key: 'key', header: 'KEY' },
                { key: 'value', header: 'VALUE' },
                { key: 'source', header: 'SOURCE' }
            ]
        )
    }
}
