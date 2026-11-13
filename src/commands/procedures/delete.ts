import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'

export default class ProceduresDelete extends AgentCommand {
    static override description =
        'Delete a procedure and its run history from the live agent at once'
    static override examples = [
        '<%= config.bin %> procedures delete 0b8f3c1e-... -a agt_123'
    ]
    static override args = {
        procedureId: Args.string({
            required: true,
            description: 'Procedure ID'
        })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ProceduresDelete)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { error, response } = await client.DELETE(
            '/agents/{agentId}/procedures/{procedureId}',
            { params: { path: { agentId, procedureId: args.procedureId } } }
        )
        throwIfError(response, error)
        this.success(flags, `Deleted procedure ${args.procedureId}`)
        this.note(
            flags,
            'Publishing an older draft can bring the procedure back, but not its run history.'
        )
    }
}
