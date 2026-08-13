import { ListCommand } from '../../base/list-command.js'
import { SOURCE_COLUMNS, toSourceRow } from '../../base/sources.js'
import { fetchAllPages } from '../../client/paginate.js'

export default class SourcesList extends ListCommand {
    static override description = 'List sources for an agent'
    static override examples = [
        '<%= config.bin %> sources list -a agt_123',
        '<%= config.bin %> sources list -a agt_123 --all --json'
    ]
    static override flags = { ...ListCommand.baseFlags }

    async run(): Promise<void> {
        const { flags } = await this.parse(SourcesList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const mode = this.mode(flags)

        const { pages, items } = await fetchAllPages<Record<string, unknown>>(
            (query) =>
                client.GET('/agents/{agentId}/sources', {
                    params: { path: { agentId }, query }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const rows = items.map((s) => toSourceRow(s, mode))
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }

        this.printData(flags, raw, rows, SOURCE_COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
