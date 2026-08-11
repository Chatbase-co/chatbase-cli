import { Args } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsClone extends BaseCommand {
    static override description =
        'Clone an agent, including all its sources (excluding Notion)'
    static override examples = ['<%= config.bin %> agents clone agt_123']
    static override args = {
        agentId: Args.string({
            required: true,
            description: 'Agent ID to clone'
        })
    }
    static override flags = { ...BaseCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsClone)
        const client = this.apiClient(flags)
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/clone',
            { params: { path: { agentId: args.agentId } } }
        )
        throwIfError(response, error)
        // Note: POST /agents/{agentId}/clone returns AgentCreatedResponse directly ({ id, pendingSteps? }), not wrapped in { data: ... }
        const id = (data as { id: string }).id
        this.success(flags, `Cloned agent ${args.agentId} → ${id}`)
        process.stdout.write(`${id}\n`)
    }
}
