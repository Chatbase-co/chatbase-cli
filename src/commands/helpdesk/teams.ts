import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' }
]

export default class HelpdeskTeams extends AgentCommand {
    static override description = 'List helpdesk teams for an agent'
    static override examples = ['<%= config.bin %> helpdesk teams -a agt_123']
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(HelpdeskTeams)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/helpdesk/teams',
            { params: { path: { agentId } } }
        )
        throwIfError(response, error)
        // TeamListResponse is a bare array, not wrapped in {data, pagination}.
        const teams = data as unknown as Array<Record<string, unknown>>
        const rows = teams.map((t) => ({
            id: String(t.id ?? ''),
            name: String(t.name ?? '')
        }))
        this.printData(flags, data, rows, COLUMNS)
    }
}
