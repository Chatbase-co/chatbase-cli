import { Args, Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import type { components, operations } from '../../generated/api.js'
import { type Column, formatEpochSeconds } from '../../output/render.js'

type SearchQuery = NonNullable<
    operations['searchConversations']['parameters']['query']
>
type SearchResult = components['schemas']['ConversationSearchResult']

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'source', header: 'SOURCE' },
    { key: 'status', header: 'STATUS' },
    { key: 'updatedAt', header: 'UPDATED' },
    { key: 'snippet', header: 'SNIPPET' }
]

const WINDOW_NOTE =
    'Must fall inside the search window (conversations created since the 1st of the month 12 months ago, UTC); use `conversations export` for older data.'

/** String filters that pass straight through: flag name → query param. */
const LIST_FILTERS = {
    source: 'source',
    sentiment: 'sentiment',
    topic: 'topic',
    'user-id': 'userId',
    'activity-state': 'activityState',
    feedback: 'feedback',
    'action-type': 'actionType',
    tool: 'tool',
    'tool-outcome': 'toolOutcome',
    procedure: 'procedure',
    'procedure-outcome': 'procedureOutcome',
    'start-date': 'startDate',
    'end-date': 'endDate',
    'updated-after': 'updatedAfter',
    'updated-before': 'updatedBefore'
} as const satisfies Record<string, keyof SearchQuery>

export default class ConversationsSearch extends ListCommand {
    static override summary =
        'Search an agent’s conversations by text, filters, or both'
    static override description =
        'Search conversations across sources (narrow with --source). ' +
        'With QUERY, results are ranked by relevance and carry a matching ' +
        'snippet; without it, the most recently active come first. Filters ' +
        'combine with AND; comma-separated values within one filter combine ' +
        'with OR.\n\n' +
        'Coverage: conversations created since the 1st of the month 12 months ' +
        'ago (UTC). Use `chatbase conversations export` for older ' +
        'conversations, and `conversations export --conversation <id>` to ' +
        'read a result’s full message history.'
    static override examples = [
        '<%= config.bin %> conversations search "refund" -a agt_123',
        '<%= config.bin %> conversations search -a agt_123 --source WhatsApp,Instagram --sentiment negative',
        '<%= config.bin %> conversations search "cancel" -a agt_123 --escalated --updated-after 2026-09-01',
        '<%= config.bin %> conversations search -a agt_123 --tool lookup_order --tool-outcome error --all --json'
    ]
    static override args = {
        query: Args.string({
            description:
                'Free-text search over messages and titles (omit to filter only)'
        })
    }
    static override flags = {
        ...ListCommand.baseFlags,
        limit: Flags.integer({
            description: 'Maximum items per page (1–25, default 25)',
            min: 1,
            max: 25
        }),
        cursor: Flags.string({
            description:
                'Pagination cursor from a previous page; repeat the same QUERY and filters or the API rejects it'
        }),
        source: Flags.string({
            description:
                'Filter by source (comma-separated, e.g. API,WhatsApp,"Widget or Iframe")'
        }),
        sentiment: Flags.string({
            description:
                'Filter by sentiment (comma-separated): positive, neutral, negative, unspecified'
        }),
        topic: Flags.string({
            description:
                'Filter by topic name (comma-separated), or "unspecified" for none'
        }),
        'user-id': Flags.string({
            description: 'Filter by user ID (comma-separated)'
        }),
        'activity-state': Flags.string({
            description:
                'Filter by state (comma-separated): ongoing, ended, taken_over, paused'
        }),
        feedback: Flags.string({
            description:
                'Filter by message rating (comma-separated): positive, negative'
        }),
        escalated: Flags.boolean({
            description:
                'Only conversations escalated to a human (ticket or live-chat handoff)'
        }),
        'action-type': Flags.string({
            description:
                'Filter by action type that ran (comma-separated, e.g. collect-leads)'
        }),
        tool: Flags.string({
            description: 'Filter by tool name that was called (comma-separated)'
        }),
        'tool-outcome': Flags.string({
            description:
                'Filter by tool result status (comma-separated, e.g. error); scoped to --tool when set'
        }),
        procedure: Flags.string({
            description: 'Filter by procedure name that ran (comma-separated)'
        }),
        'procedure-outcome': Flags.string({
            description:
                'Filter by procedure run status (comma-separated); scoped to --procedure when set'
        }),
        'has-voice': Flags.boolean({
            description:
                'Only conversations with a voice session (--no-has-voice: only without)',
            allowNo: true
        }),
        // Date semantics (bare-date day boundaries, inverted-window rejection)
        // belong to the API, so these pass through unparsed — same as
        // `conversations list`.
        'start-date': Flags.string({
            description: `Created at or after this YYYY-MM-DD date or ISO 8601 date-time. ${WINDOW_NOTE}`
        }),
        'end-date': Flags.string({
            description: `Created at or before this YYYY-MM-DD date (inclusive) or ISO 8601 date-time. ${WINDOW_NOTE}`
        }),
        'updated-after': Flags.string({
            description:
                'Last active at or after this YYYY-MM-DD date or ISO 8601 date-time'
        }),
        'updated-before': Flags.string({
            description: `Last active at or before this YYYY-MM-DD date (inclusive) or ISO 8601 date-time. ${WINDOW_NOTE}`
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConversationsSearch)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const extraQuery: SearchQuery = {}
        if (args.query) extraQuery.query = args.query
        for (const [flag, param] of Object.entries(LIST_FILTERS)) {
            const value = flags[flag as keyof typeof LIST_FILTERS]
            if (value) extraQuery[param] = value
        }
        // The spec types these as string enums, not booleans: escalated only
        // accepts "true", hasVoice "true" | "false".
        if (flags.escalated) extraQuery.escalated = 'true'
        if (flags['has-voice'] !== undefined)
            extraQuery.hasVoice = flags['has-voice'] ? 'true' : 'false'

        const { pages, items } = await fetchPages<SearchResult>(
            (query) =>
                client.GET('/agents/{agentId}/conversations/search', {
                    params: {
                        path: { agentId },
                        query: { ...query, ...extraQuery }
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const formatTimestamp =
            this.mode(flags) === 'pretty'
                ? formatEpochSeconds
                : (v: unknown) => String(v ?? '')
        const rows = items.map((c) => ({
            id: c.id,
            title: c.title ?? '',
            source: c.source ?? '',
            status: c.status,
            updatedAt: formatTimestamp(c.updatedAt),
            // null without a QUERY, or when only the title matched
            snippet: (c.snippet?.highlights ?? [])
                .map((h) => h.value)
                .join('')
                .replace(/\s+/g, ' ')
                .trim()
        }))
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            // The API may return a short or even empty page while more
            // matches remain, so "No results." above is not the final word.
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} and the same query and filters (or use --all)`
            )
        }
    }
}
