import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'

export default class ActionsDelete extends AgentCommand {
    static override description =
        'Delete an action from the live agent at once (refused while a procedure mentions it)'
    static override examples = [
        '<%= config.bin %> actions delete 0b8f3c1e-... -a agt_123'
    ]
    static override args = {
        actionId: Args.string({ required: true, description: 'Action ID' })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ActionsDelete)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { error, response } = await client.DELETE(
            '/agents/{agentId}/actions/{actionId}',
            { params: { path: { agentId, actionId: args.actionId } } }
        )
        throwIfError(response, error)
        this.success(flags, `Deleted action ${args.actionId}`)
        this.note(flags, 'Publishing an older draft can bring the action back.')
    }
}
