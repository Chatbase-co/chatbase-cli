import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'

export default class AgentsGet extends AgentCommand {
    static override description = 'Show one agent'
    static override examples = [
        '<%= config.bin %> agents get agt_123',
        '<%= config.bin %> agents get'
    ]
    static override args = {
        agentId: Args.string({ required: false, description: 'Agent ID' })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsGet)
        if (args.agentId && flags.agent) {
            throw new UsageError(
                'Pass the agent ID either positionally or via -a, not both.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = args.agentId ?? (await this.agentId(flags, client))
        const { data, error, response } = await client.GET(
            '/agents/{agentId}',
            {
                params: { path: { agentId } }
            }
        )
        throwIfError(response, error)
        const a = data as Record<string, unknown>
        this.printData(
            flags,
            data,
            [
                {
                    id: String(a.id),
                    name: String(a.name),
                    model: String(a.model ?? ''),
                    visibility: String(a.visibility ?? '')
                }
            ],
            [
                { key: 'id', header: 'ID' },
                { key: 'name', header: 'NAME' },
                { key: 'model', header: 'MODEL' },
                { key: 'visibility', header: 'VISIBILITY' }
            ]
        )
    }
}
