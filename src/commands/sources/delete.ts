import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'

export default class SourcesDelete extends AgentCommand {
    static override description =
        'Delete a source (restorable via restore command)'
    static override examples = [
        '<%= config.bin %> sources delete src_1 -a agt_1'
    ]
    static override args = {
        sourceId: Args.string({ required: true, description: 'Source ID' })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesDelete)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { error, response } = await client.DELETE(
            '/agents/{agentId}/sources/{sourceId}',
            {
                params: { path: { agentId, sourceId: args.sourceId } }
            }
        )
        throwIfError(response, error)
        this.success(flags, `Deleted source ${args.sourceId}`)
        this.note(
            flags,
            `↩ restore with: chatbase sources restore ${args.sourceId} -a ${agentId}`
        )
    }
}
