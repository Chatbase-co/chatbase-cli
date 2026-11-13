import { Args } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'type', header: 'TYPE' },
    { key: 'status', header: 'STATUS' },
    { key: 'procedureOnly', header: 'PROCEDURE-ONLY' },
    { key: 'whenToUse', header: 'WHEN TO USE' }
]

export default class ActionsGet extends AgentCommand {
    static override description =
        'Show one action: when to use it, the fields it collects, and its channels'
    static override examples = [
        '<%= config.bin %> actions get 0b8f3c1e-... -a agt_123',
        '<%= config.bin %> actions get 0b8f3c1e-... -a agt_123 --json'
    ]
    static override args = {
        actionId: Args.string({ required: true, description: 'Action ID' })
    }
    static override flags = { ...AgentCommand.baseFlags }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ActionsGet)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/actions/{actionId}',
            { params: { path: { agentId, actionId: args.actionId } } }
        )
        throwIfError(response, error)
        const a = data as NonNullable<typeof data>
        const row = {
            id: a.id,
            name: a.name,
            type: a.type,
            status: a.status,
            procedureOnly: String(a.procedureOnly),
            whenToUse: a.whenToUse ?? ''
        }
        const fields = a.fields
            .map(
                (f) =>
                    `${f.name} (${f.source}${f.required ? ', required' : ''})`
            )
            .join(', ')
        const channels = a.channels
            .map((c) => `${c.channel}=${c.enabled ? 'on' : 'off'}`)
            .join(', ')
        this.printDetail(flags, data, row, COLUMNS, [
            ['ID', row.id],
            ['Name', row.name],
            ['Type', row.type],
            ['Status', row.status],
            ['Procedure-only', row.procedureOnly],
            ['When to use', row.whenToUse],
            ['Fields', fields],
            ['Channels', channels]
        ])
    }
}
