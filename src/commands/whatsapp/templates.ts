import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'
import type { Column } from '../../output/render.js'

type TemplatesResponse = components['schemas']['ListWhatsAppTemplatesResponse']

const COLUMNS: Column[] = [
    { key: 'name', header: 'NAME' },
    { key: 'language', header: 'LANGUAGE' },
    { key: 'category', header: 'CATEGORY' },
    { key: 'format', header: 'FORMAT' },
    { key: 'wabaId', header: 'WABA' },
    { key: 'variables', header: 'VARIABLES' }
]

/** {header: ["1"], body: ["1","2"]} → "header:1 body:1,2" — the keys a send
 * must supply, in the grouping `send-template --variables` expects. */
function variablesSummary(variables: Record<string, string[]>): string {
    return Object.entries(variables)
        .map(([component, keys]) => `${component}:${keys.join(',')}`)
        .join(' ')
}

export default class WhatsappTemplates extends AgentCommand {
    static override summary = 'List approved WhatsApp templates for an agent'
    static override description =
        'List the approved WhatsApp templates available to the agent, across ' +
        'all of its connected WhatsApp Business Accounts. A template can only ' +
        'be sent from a number on its own Business Account — pick a sender ' +
        'whose WABA matches the template’s WABA column.'
    static override examples = [
        '<%= config.bin %> whatsapp templates -a agt_123',
        '<%= config.bin %> whatsapp templates -a agt_123 --json'
    ]
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(WhatsappTemplates)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/whatsapp/templates',
            { params: { path: { agentId } } }
        )
        throwIfError(response, error)
        const result = data as TemplatesResponse
        const rows = result.templates.map((t) => ({
            name: t.name,
            language: t.language,
            category: t.category,
            format: t.parameterFormat,
            wabaId: t.wabaId,
            variables: variablesSummary(t.variables)
        }))
        this.printData(flags, result, rows, COLUMNS)
        if (result.senders.length > 0) {
            const senders = result.senders
                .map(
                    (s) =>
                        `${s.from}${s.verifiedName ? ` (${s.verifiedName})` : ''} — waba ${s.wabaId}`
                )
                .join('; ')
            this.note(flags, `Senders: ${senders}`)
        }
        if (!result.complete) {
            this.note(
                flags,
                `Warning: partial list — could not read WABA(s): ${result.unavailableWabaIds.join(', ')}. Retry to pick them up.`
            )
        }
    }
}
