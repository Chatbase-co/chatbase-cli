import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import { UsageError } from '../../errors/errors.js'
import { type Column, formatEpochSeconds } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'status', header: 'STATUS' },
    { key: 'createdAt', header: 'CREATED' },
    { key: 'updatedAt', header: 'UPDATED' }
]

/** Printed after every result: the endpoint's scope is the single most
 * common source of "the CLI is broken" reports, because an agent whose
 * traffic is all widget/Slack legitimately lists zero rows here. */
const SCOPE_NOTE =
    'Note: API-created conversations only — use `chatbase conversations export` for widget and integration conversations.'

export default class ConversationsList extends ListCommand {
    static override summary = 'List an agent’s API-created conversations'
    static override description =
        'List conversations for an agent, newest first.\n\n' +
        'Scope: the API v2 list endpoint returns only conversations created ' +
        'programmatically through the API. Conversations from the chat bubble ' +
        'and external integrations (Slack, WhatsApp, Instagram, Messenger, and ' +
        'the like) are not accessible here and are not counted in `total`. ' +
        'Use `chatbase conversations export` to read conversations from every ' +
        'source — it also embeds full message history, which `conversations ' +
        'get` and `messages list` cannot retrieve for those conversations.'
    static override examples = [
        '<%= config.bin %> conversations list -a agt_123',
        '<%= config.bin %> conversations list -a agt_123 --user usr_456',
        '<%= config.bin %> conversations list -a agt_123 --start-date 2024-01-01 --end-date 2024-01-31',
        '<%= config.bin %> conversations list -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        user: Flags.string({
            description:
                'List conversations for a specific user (uses GET /users/{userId}/conversations)'
        }),
        // The API owns the day-boundary semantics (a bare YYYY-MM-DD start is
        // the beginning of that day, an end is the *end* of it) and rejects an
        // inverted window with VALIDATION_INVALID_DATE_RANGE, so these pass
        // through unparsed rather than half-reimplementing that rule here.
        'start-date': Flags.string({
            description:
                'Only conversations created at or after this YYYY-MM-DD date or ISO 8601 date-time'
        }),
        'end-date': Flags.string({
            description:
                'Only conversations created at or before this YYYY-MM-DD date (inclusive) or ISO 8601 date-time'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const fetcherPath = flags.user
            ? '/agents/{agentId}/users/{userId}/conversations'
            : '/agents/{agentId}/conversations'

        // The per-user endpoint takes only cursor/limit. Sending a date window
        // there would be dropped server-side and quietly return the unfiltered
        // list, so refuse instead of returning a wrong answer.
        if (flags.user && (flags['start-date'] || flags['end-date'])) {
            throw new UsageError(
                '--start-date/--end-date are not supported with --user. Drop --user to filter by date, then filter the results by userId.'
            )
        }

        const extraQuery: Record<string, unknown> = {}
        if (flags['start-date']) extraQuery.startDate = flags['start-date']
        if (flags['end-date']) extraQuery.endDate = flags['end-date']

        const { pages, items } = await fetchPages<Record<string, unknown>>(
            (query) =>
                client.GET(fetcherPath as any, {
                    params: {
                        path: {
                            agentId,
                            ...(flags.user ? { userId: flags.user } : {})
                        },
                        query: { ...query, ...extraQuery }
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        // Humans read ISO dates; --plain keeps the raw epoch for scripts.
        const formatTimestamp =
            this.mode(flags) === 'pretty'
                ? formatEpochSeconds
                : (v: unknown) => String(v ?? '')
        const rows = items.map((c) => ({
            id: String(c.id ?? ''),
            title: String(c.title ?? ''),
            status: String(c.status ?? ''),
            createdAt: formatTimestamp(c.createdAt),
            updatedAt: formatTimestamp(c.updatedAt)
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
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
        this.note(flags, SCOPE_NOTE)
    }
}
