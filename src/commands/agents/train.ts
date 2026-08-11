import { Args } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsTrain extends BaseCommand {
    static override description = 'Queue a training job for an agent'
    static override examples = ['<%= config.bin %> agents train agt_123']
    static override args = {
        agentId: Args.string({
            required: true,
            description: 'Agent ID to train'
        })
    }
    static override flags = { ...BaseCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsTrain)
        const client = this.apiClient(flags)
        const { error, response } = await client.POST(
            '/agents/{agentId}/train',
            {
                params: { path: { agentId: args.agentId } }
            }
        )
        throwIfError(response, error)
        this.success(flags, `Training started for ${args.agentId}`)
    }
}
