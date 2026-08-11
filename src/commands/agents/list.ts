import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'name', header: 'NAME' },
    { key: 'model', header: 'MODEL' },
    { key: 'visibility', header: 'VISIBILITY' }
]

export default class AgentsList extends BaseCommand {
    static override description = 'List all agents in the workspace'
    static override examples = [
        '<%= config.bin %> agents list',
        '<%= config.bin %> agents list --json'
    ]
    static override flags = {
        ...BaseCommand.baseFlags,
        limit: Flags.integer({ description: 'Maximum items per page' }),
        cursor: Flags.string({
            description: 'Pagination cursor from a previous page'
        }),
        all: Flags.boolean({ description: 'Fetch every page' })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(AgentsList)
        const client = this.apiClient(flags)
        type Page = {
            data: Array<Record<string, unknown>>
            pagination: { cursor?: string | null; hasMore: boolean }
        }
        const pages: Page[] = []
        let cursor = flags.cursor
        for (;;) {
            const { data, error, response } = await client.GET('/agents', {
                params: { query: { cursor, limit: flags.limit } }
            })
            throwIfError(response, error)
            const page = data as unknown as Page
            pages.push(page)
            if (
                !flags.all ||
                !page.pagination.hasMore ||
                !page.pagination.cursor
            )
                break
            cursor = page.pagination.cursor
        }
        const rows = pages.flatMap((p) =>
            p.data.map((a) => ({
                id: String(a.id ?? ''),
                name: String(a.name ?? ''),
                model: String(a.model ?? ''),
                visibility: String(a.visibility ?? '')
            }))
        )
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : {
                      data: pages.flatMap((p) => p.data),
                      pagination: last?.pagination
                  }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
