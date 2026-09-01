import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'type', header: 'TYPE' },
    { key: 'count', header: 'COUNT' },
    { key: 'size', header: 'SIZE' }
]

export default class SourcesSummary extends AgentCommand {
    static override description =
        'Show aggregated source counts and sizes for an agent'
    static override examples = ['<%= config.bin %> sources summary -a agt_123']
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(SourcesSummary)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/sources/summary',
            { params: { path: { agentId } } }
        )
        throwIfError(response, error)
        const summary = data as unknown as Record<string, unknown>
        // Per-type {count, size} objects flatten to table columns; the one
        // non-object field (shouldRetrain) reads better as a note than a row.
        const rows = Object.entries(summary)
            .filter(
                (entry): entry is [string, { count?: number; size?: number }] =>
                    typeof entry[1] === 'object' && entry[1] !== null
            )
            .map(([type, value]) => ({
                type,
                count: String(value.count ?? 0),
                size: String(value.size ?? 0)
            }))
        this.printData(flags, data, rows, COLUMNS)
        if (!flags.json && summary.shouldRetrain === true) {
            this.note(
                flags,
                'Sources changed since the last training — run `chatbase agents train` to retrain.'
            )
        }
    }
}
