import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readTextInput } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type SubmitToolResultRequest = components['schemas']['SubmitToolResultRequest']

export default class ConversationsToolResult extends AgentCommand {
    static override summary = 'Submit a client-side tool result to a chat turn'
    static override description =
        'Submit the result of a client-side tool call so the paused chat ' +
        'turn can continue. The tool call ID comes from the tool-call part ' +
        'of the chat response that requested the execution.'
    static override examples = [
        '<%= config.bin %> conversations tool-result conv_123 --tool-call-id tc_1 --output \'{"temperature": 72}\' -a agt_123',
        '<%= config.bin %> conversations tool-result conv_123 --tool-call-id tc_1 --output @result.json -a agt_123',
        '<%= config.bin %> conversations tool-result conv_123 --tool-call-id tc_1 -a agt_123'
    ]
    static override args = {
        conversationId: Args.string({
            required: false,
            description: 'Conversation ID (alternative to --conversation)'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            description: 'Conversation ID'
        }),
        'tool-call-id': Flags.string({
            required: true,
            description:
                'The toolCallId from the tool-call part in the chat response'
        }),
        output: Flags.string({
            description:
                'Result of executing the tool (inline JSON, @file, or @-); ' +
                'a value that is not valid JSON is sent as a plain string'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsToolResult)
        // Positional and flag are alternatives — `agents get <id>` set the
        // positional convention, the flag predates it and stays supported.
        const conversationId = args.conversationId ?? flags.conversation
        if (!conversationId) {
            throw new UsageError(
                'Missing conversation ID. Pass it positionally (`conversations tool-result <id> ...`) or via --conversation.'
            )
        }
        if (args.conversationId && flags.conversation) {
            throw new UsageError(
                'Pass the conversation ID either positionally or via --conversation, not both.'
            )
        }
        const body: SubmitToolResultRequest = {
            toolCallId: flags['tool-call-id']
        }
        if (flags.output !== undefined) {
            const raw = await readTextInput(flags.output, '--output')
            // Tool outputs are arbitrary values in the spec: parse JSON when
            // it is JSON, otherwise pass the text through as a string.
            try {
                body.output = JSON.parse(raw)
            } catch {
                body.output = raw
            }
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/conversations/{conversationId}/tool-result',
            {
                params: { path: { agentId, conversationId } },
                body
            }
        )
        throwIfError(response, error)
        if (flags.json) {
            process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
            return
        }
        this.success(
            flags,
            `Tool result submitted for ${flags['tool-call-id']}`
        )
    }
}
