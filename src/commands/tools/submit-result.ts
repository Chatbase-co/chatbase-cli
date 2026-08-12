import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'

export default class ToolsSubmitResult extends AgentCommand {
    static override description = 'Submit the result of a client-side tool call'
    static override examples = [
        '<%= config.bin %> tools submit-result --conversation conv_123 --data \'{"toolCallId":"tc_1","output":{"ok":true}}\' -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            required: true,
            description: 'Conversation ID'
        }),
        data: Flags.string({
            required: true,
            description:
                'Tool result JSON body: { toolCallId, output } (@file, @-, or inline)'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ToolsSubmitResult)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const body = await readBodyData(flags.data)
        const { error, response } = await client.POST(
            '/agents/{agentId}/conversations/{conversationId}/tool-result',
            {
                params: {
                    path: {
                        agentId,
                        conversationId: flags.conversation
                    }
                },
                body: body as never
            }
        )
        throwIfError(response, error)
        this.success(
            flags,
            `Tool result submitted for conversation ${flags.conversation}`
        )
    }
}
