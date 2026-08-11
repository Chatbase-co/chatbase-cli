import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import { SOURCE_COLUMNS, toSourceRow } from './shared.js'

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
        this.printData(
            flags,
            data,
            [toSourceRow(source, this.mode(flags))],
            SOURCE_COLUMNS
        )
    }
}
