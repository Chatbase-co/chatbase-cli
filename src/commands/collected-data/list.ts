import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import type { components, operations } from '../../generated/api.js'
import { type Column, formatEpochSeconds } from '../../output/render.js'

type Query = NonNullable<operations['listCollectedData']['parameters']['query']>
type Submission = components['schemas']['CollectedDataSubmission']

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'actionName', header: 'ACTION' },
    { key: 'conversationId', header: 'CONVERSATION' },
    { key: 'fields', header: 'FIELDS' },
    { key: 'createdAt', header: 'CREATED' }
]

export default class CollectedDataList extends ListCommand {
    static override summary =
        'List data saved by an agent’s Collect data actions'
    static override description =
        'Lists submissions newest first. Narrow by action with --action-id ' +
        'and by submission time with --start-date / --end-date.'
    static override examples = [
        '<%= config.bin %> collected-data list -a agt_123',
        '<%= config.bin %> collected-data list -a agt_123 --action-id 3f6c1a2e-0000-4000-8000-000000000000 --start-date 2026-11-01',
        '<%= config.bin %> collected-data list -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        'action-id': Flags.string({
            description: 'Only submissions collected by this action (UUID)'
        }),
        // Day-boundary semantics belong to the API, so dates pass through unparsed.
        'start-date': Flags.string({
            description:
                'Created after this YYYY-MM-DD date (start of day, UTC) or ISO 8601 date-time'
        }),
        'end-date': Flags.string({
            description:
                'Created at or before this YYYY-MM-DD date (inclusive, end of day UTC) or ISO 8601 date-time'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(CollectedDataList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const filters: Query = {}
        if (flags['action-id']) filters.actionId = flags['action-id']
        if (flags['start-date']) filters.startDate = flags['start-date']
        if (flags['end-date']) filters.endDate = flags['end-date']

        const { pages, items } = await fetchPages<Submission>(
            (query) =>
                client.GET('/agents/{agentId}/collected-data', {
                    params: {
                        path: { agentId },
                        query: { ...query, ...filters }
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const formatTimestamp =
            this.mode(flags) === 'pretty'
                ? formatEpochSeconds
                : (v: unknown) => String(v ?? '')
        const rows = items.map((s) => ({
            id: s.id,
            actionName: s.actionName,
            conversationId: s.conversationId ?? '',
            fields: s.customFields ? JSON.stringify(s.customFields) : '',
            createdAt: formatTimestamp(s.createdAt)
        }))
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }
        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} and the same filters (or use --all)`
            )
        }
    }
}
