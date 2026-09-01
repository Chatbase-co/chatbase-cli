import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'category', header: 'CATEGORY' },
    { key: 'label', header: 'LABEL' }
]

export default class HelpdeskStatuses extends AgentCommand {
    static override description = 'List ticket statuses for an agent'
    static override examples = [
        '<%= config.bin %> helpdesk statuses -a agt_123'
    ]
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(HelpdeskStatuses)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/helpdesk/ticket-statuses',
            { params: { path: { agentId } } }
        )
        throwIfError(response, error)
        // TicketStatusList is a bare array, not wrapped in {data, pagination}.
        const statuses = data as unknown as Array<Record<string, unknown>>
        const rows = statuses.map((s) => ({
            id: String(s.id ?? ''),
            category: String(s.category ?? ''),
            // internalLabel is the dashboard/agent-facing label — the more
            // relevant of the two for a CLI operator picking a statusId.
            label: String(s.internalLabel ?? '')
        }))
        this.printData(flags, data, rows, COLUMNS)
    }
}
