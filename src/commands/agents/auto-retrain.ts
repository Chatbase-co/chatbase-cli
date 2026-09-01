import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type UpdateAgentAutoRetrainBody =
    components['schemas']['UpdateAgentAutoRetrainBody']

export default class AgentsAutoRetrain extends AgentCommand {
    static override description =
        'Enable or disable automatic retraining for an agent'
    static override examples = [
        '<%= config.bin %> agents auto-retrain agt_123 --enabled',
        '<%= config.bin %> agents auto-retrain --enabled'
    ]
    static override args = {
        agentId: Args.string({
            required: false,
            description: 'Agent ID'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        enabled: Flags.boolean({
            description: 'Enable automatic retraining',
            exactlyOne: ['enabled', 'disabled']
        }),
        disabled: Flags.boolean({
            description: 'Disable automatic retraining',
            exactlyOne: ['enabled', 'disabled']
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsAutoRetrain)
        if (args.agentId && (flags.agent || flags['agent-name'])) {
            throw new UsageError(
                'Pass the agent ID either positionally or via -a/--agent-name, not both.'
            )
        }
        const body: UpdateAgentAutoRetrainBody = {
            enabled: flags.enabled === true
        }
        const client = this.apiClient(flags)
        const agentId = args.agentId ?? (await this.agentId(flags, client))
        const { error, response } = await client.PUT(
            '/agents/{agentId}/auto-retrain',
            {
                params: { path: { agentId } },
                body
            }
        )
        throwIfError(response, error)
        const status = flags.enabled ? 'enabled' : 'disabled'
        this.success(flags, `Auto-retrain ${status} for ${agentId}`)
    }
}
