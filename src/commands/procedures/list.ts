import { ListCommand } from '../../base/list-command.js'
import { PROCEDURE_COLUMNS, procedureRow } from '../../base/procedures.js'
import { fetchPages } from '../../client/paginate.js'
import type { components } from '../../generated/api.js'

type ProcedureListItem = components['schemas']['ProcedureListItem']

export default class ProceduresList extends ListCommand {
    static override description =
        "List an agent's procedures, newest first (steps are not included; use `procedures get`)"
    static override examples = [
        '<%= config.bin %> procedures list -a agt_123',
        '<%= config.bin %> procedures list -a agt_123 --all --json'
    ]
    static override flags = { ...ListCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(ProceduresList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchPages<ProcedureListItem>(
            (query) =>
                client.GET('/agents/{agentId}/procedures', {
                    params: { path: { agentId }, query }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )
        const last = pages.at(-1)
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }

        this.printData(flags, raw, items.map(procedureRow), PROCEDURE_COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
