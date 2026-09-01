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
        if (args.agentId && (flags.agent || flags['agent-name'])) {
            throw new UsageError(
                'Pass the agent ID either positionally or via -a/--agent-name, not both.'
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
        const str = (v: unknown) => (v == null ? '' : String(v))
        this.printDetail(
            flags,
            data,
            {
                id: str(a.id),
                name: str(a.name),
                model: str(a.model),
                visibility: str(a.visibility)
            },
            [
                { key: 'id', header: 'ID' },
                { key: 'name', header: 'NAME' },
                { key: 'model', header: 'MODEL' },
                { key: 'visibility', header: 'VISIBILITY' }
            ],
            [
                ['ID', str(a.id)],
                ['Name', str(a.name)],
                ['Model', str(a.model)],
                ['Visibility', str(a.visibility)],
                ['Status', str(a.status)],
                ['Auto-retrain', str(a.autoRetrain)],
                ['Temperature', str(a.temp)],
                ['Size', str(a.size)],
                ['Created', str(a.createdAt)],
                ['Last trained', str(a.lastTrainedAt)],
                ['Instructions', str(a.instructions)]
            ]
        )
    }
}
