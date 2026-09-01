import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'

export default class SourcesRestore extends AgentCommand {
    static override description = 'Restore a deleted source'
    static override examples = [
        '<%= config.bin %> sources restore src_1 -a agt_1'
    ]
    static override args = {
        sourceId: Args.string({ required: true, description: 'Source ID' })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesRestore)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { error, response } = await client.POST(
            '/agents/{agentId}/sources/{sourceId}/restore',
            {
                params: { path: { agentId, sourceId: args.sourceId } }
            }
        )
        throwIfError(response, error)
        this.success(flags, `Restored source ${args.sourceId}`)
    }
}
