import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { SOURCE_COLUMNS, toSourceRow } from '../../base/sources.js'
import { throwIfError } from '../../client/client.js'

export default class SourcesGet extends AgentCommand {
    static override description = 'Show one source'
    static override examples = [
        '<%= config.bin %> sources get src_123 -a agt_123'
    ]
    static override args = {
        sourceId: Args.string({ required: true, description: 'Source ID' })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesGet)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/sources/{sourceId}',
            {
                params: { path: { agentId, sourceId: args.sourceId } }
            }
        )
        throwIfError(response, error)
        const source = data as unknown as Record<string, unknown>
        const row = toSourceRow(source, this.mode(flags))
        const str = (v: unknown) => (v == null ? '' : String(v))
        this.printDetail(flags, data, row, SOURCE_COLUMNS, [
            ['ID', row.id],
            ['Name', row.name],
            ['Type', row.type],
            ['Status', row.status],
            ['Size', row.size],
            ['Created', str(source.createdAt)],
            ['URL', str(source.url)]
        ])
    }
}
