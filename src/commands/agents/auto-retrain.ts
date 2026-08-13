import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'

type UpdateAgentAutoRetrainBody =
    components['schemas']['UpdateAgentAutoRetrainBody']

export default class AgentsAutoRetrain extends BaseCommand {
    static override description =
        'Enable or disable automatic retraining for an agent'
    static override examples = [
        '<%= config.bin %> agents auto-retrain agt_123 --enabled',
        '<%= config.bin %> agents auto-retrain agt_123 --disabled'
    ]
    static override args = {
        agentId: Args.string({
            required: true,
            description: 'Agent ID'
        })
    }
    static override flags = {
        ...BaseCommand.baseFlags,
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

        const body: UpdateAgentAutoRetrainBody = {
            enabled: flags.enabled === true
        }
        const client = this.apiClient(flags)
        const { error, response } = await client.PUT(
            '/agents/{agentId}/auto-retrain',
            {
                params: { path: { agentId: args.agentId } },
                body
            }
        )
        throwIfError(response, error)
        const status = flags.enabled ? 'enabled' : 'disabled'
        this.success(flags, `Auto-retrain ${status} for ${args.agentId}`)
    }
}
