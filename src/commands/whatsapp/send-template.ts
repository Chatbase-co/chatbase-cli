import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readTextInput } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type SendTemplateBody = components['schemas']['SendWhatsAppTemplateBody']
type SendTemplateResponse =
    components['schemas']['SendWhatsAppTemplateResponse']
type TemplateVariables = NonNullable<SendTemplateBody['template']['variables']>

/** Parse --variables: a JSON object grouped by component, the exact shape
 * `whatsapp templates` reports per template. Leaf validation is the API's
 * job — it returns field-level errors for bad keys or non-string values. */
async function parseVariables(value: string): Promise<TemplateVariables> {
    const raw = await readTextInput(value, '--variables')
    let parsed: unknown
    try {
        parsed = JSON.parse(raw)
    } catch {
        throw new UsageError(
            '--variables must be valid JSON (inline, @file, or @-).'
        )
    }
    if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed)
    ) {
        throw new UsageError(
            '--variables must be a JSON object grouped by component, e.g. \'{"body":{"1":"Jane"}}\'.'
        )
    }
    return parsed as TemplateVariables
}

export default class WhatsappSendTemplate extends AgentCommand {
    static override summary = 'Send an approved WhatsApp template message'
    static override description =
        'Send an approved WhatsApp template to a phone number from one of the ' +
        'agent’s connected numbers. No user ID is needed — a Chatbase user is ' +
        'resolved or created from the recipient number, and replies flow ' +
        'through the agent’s regular WhatsApp pipeline. Use `whatsapp ' +
        'templates` to see available templates and the variables each expects.'
    static override examples = [
        '<%= config.bin %> whatsapp send-template order_update --to 14155552671 -a agt_123',
        '<%= config.bin %> whatsapp send-template order_update --to 14155552671 --language en_US --variables \'{"header":{"1":"#1042"},"body":{"1":"Jane","2":"Friday"}}\' -a agt_123'
    ]
    static override args = {
        template: Args.string({
            required: true,
            description: 'Name of the approved template'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        to: Flags.string({
            required: true,
            description:
                'Recipient phone number in international format (digits with country code)'
        }),
        from: Flags.string({
            description:
                'Which connected WhatsApp number to send from — optional when the agent has exactly one'
        }),
        language: Flags.string({
            description:
                'Template language code (e.g. en_US) — optional when the template exists in a single language'
        }),
        variables: Flags.string({
            description:
                'Template variable values as JSON grouped by component (@file, @-, or inline), e.g. \'{"body":{"1":"Jane"}}\''
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(WhatsappSendTemplate)
        const variables = flags.variables
            ? await parseVariables(flags.variables)
            : undefined
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const body: SendTemplateBody = {
            to: flags.to,
            ...(flags.from ? { from: flags.from } : {}),
            template: {
                name: args.template,
                ...(flags.language ? { language: flags.language } : {}),
                // The spec defaults variables to {} and the generated type
                // makes it required — send the default explicitly.
                variables: variables ?? {}
            }
        }
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/whatsapp/messages/template',
            {
                params: { path: { agentId } },
                body
            }
        )
        throwIfError(response, error)
        const sent = data as SendTemplateResponse
        if (flags.json) {
            process.stdout.write(`${JSON.stringify(sent, null, 2)}\n`)
            return
        }
        this.success(flags, `Sent template "${args.template}" to ${sent.to}`)
        if (sent.conversationId) {
            this.note(flags, `Conversation: ${sent.conversationId}`)
        }
        if (sent.messageId) {
            process.stdout.write(`${sent.messageId}\n`)
        }
    }
}
