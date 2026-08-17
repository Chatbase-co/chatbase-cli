import { Args } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsGet extends BaseCommand {
    static override description = 'Show one agent'
    static override examples = ['<%= config.bin %> agents get agt_123']
    static override args = {
        agentId: Args.string({ required: true, description: 'Agent ID' })
    }
    static override flags = { ...BaseCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsGet)
        const client = this.apiClient(flags)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}',
            {
                params: { path: { agentId: args.agentId } }
            }
        )
        throwIfError(response, error)
        // Note: GET /agents/{agentId} returns Agent directly, not wrapped in { data: ... }
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
