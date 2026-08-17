import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'

export default class AgentsTrain extends AgentCommand {
    static override description = 'Queue a training job for an agent'
    static override examples = [
        '<%= config.bin %> agents train agt_123',
        '<%= config.bin %> agents train'
    ]
    static override args = {
        agentId: Args.string({
            required: false,
            description:
                'Agent ID to train (defaults to the configured agent, like other commands)'
        })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsTrain)
        // The sources-summary retrain nudge says to run `chatbase agents
        // train` bare, so the bare form must resolve the agent the same way
        // every other command does. Positional and flag stay alternatives.
        if (args.agentId && flags.agent) {
            throw new UsageError(
                'Pass the agent ID either positionally or via -a, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = args.agentId ?? (await this.agentId(flags, client))
        const { error, response } = await client.POST(
            '/agents/{agentId}/train',
            {
                params: { path: { agentId } }
            }
        )
        throwIfError(response, error)
        this.success(flags, `Training started for ${agentId}`)
    }
}
