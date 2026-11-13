import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import type { components } from '../../generated/api.js'
import type { Column } from '../../output/render.js'

type ActionListItem = components['schemas']['ActionListItem']

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'type', header: 'TYPE' },
    { key: 'status', header: 'STATUS' },
    { key: 'procedureOnly', header: 'PROCEDURE-ONLY' }
]

export default class ActionsList extends ListCommand {
    static override description =
        "List an agent's actions, sorted by name (configuration is not included; use `actions get`)"
    static override examples = [
        '<%= config.bin %> actions list -a agt_123',
        '<%= config.bin %> actions list -a agt_123 --all --json'
    ]
    static override flags = { ...ListCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(ActionsList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchPages<ActionListItem>(
            (query) =>
                client.GET('/agents/{agentId}/actions', {
                    params: { path: { agentId }, query }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const rows = items.map((a) => ({
            id: a.id,
            name: a.name,
            type: a.type,
            status: a.status,
            procedureOnly: String(a.procedureOnly)
        }))
        const last = pages.at(-1)
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
