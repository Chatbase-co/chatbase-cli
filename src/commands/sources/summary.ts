import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'metric', header: 'METRIC' },
    { key: 'value', header: 'VALUE' }
]

function formatValue(value: unknown): string {
    if (value === null || value === undefined) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
}

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
        const rows = Object.entries(summary).map(([metric, value]) => ({
            metric,
            value: formatValue(value)
        }))
        this.printData(flags, data, rows, COLUMNS)
    }
}
