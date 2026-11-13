import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import {
    PROCEDURE_COLUMNS,
    procedureRow,
    renderSteps
} from '../../base/procedures.js'
import { throwIfError } from '../../client/client.js'

export default class ProceduresGet extends AgentCommand {
    static override description = 'Show one procedure, including its steps'
    static override examples = [
        '<%= config.bin %> procedures get 0b8f3c1e-... -a agt_123'
    ]
    static override args = {
        procedureId: Args.string({
            required: true,
            description: 'Procedure ID'
        })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ProceduresGet)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/procedures/{procedureId}',
            { params: { path: { agentId, procedureId: args.procedureId } } }
        )
        throwIfError(response, error)
        const p = data as NonNullable<typeof data>
        const row = procedureRow(p)
        this.printDetail(flags, data, row, PROCEDURE_COLUMNS, [
            ['ID', row.id],
            ['Name', row.name],
            ['Status', row.status],
            ['Trigger', row.trigger],
            ['Unavailable', row.unavailableActions],
            ['Steps', `\n${renderSteps(p.steps).join('\n')}`]
        ])
    }
}
