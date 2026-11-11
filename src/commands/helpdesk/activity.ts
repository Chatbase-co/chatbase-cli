import {
    HELPDESK_REPORT_FLAGS,
    HELPDESK_REPORT_NOTE,
    localTimezone
} from '../../base/helpdesk-report.js'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import type { components } from '../../generated/api.js'
import type { Column } from '../../output/render.js'

type ActivitySegment = components['schemas']['ActivitySegment']

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'operator', header: 'OPERATOR' },
    { key: 'kind', header: 'KIND' },
    { key: 'ticket', header: 'TICKET' },
    { key: 'startedAt', header: 'STARTED' },
    { key: 'endedAt', header: 'ENDED' }
]

export default class HelpdeskActivity extends ListCommand {
    static override summary = 'List Help Desk operator activity segments'
    static override description =
        'One item per ticket, untracked, or idle stretch of the agent’s ' +
        'current operators, listed only in the day range where it started ' +
        '(days are in --timezone). Segments are unmerged and unrounded, so ' +
        'totals can differ slightly from the dashboard’s Activity export. ' +
        'An empty ENDED means the segment is still open. ' +
        HELPDESK_REPORT_NOTE
    static override examples = [
        '<%= config.bin %> helpdesk activity -a agt_123 --start-date 2026-11-01 --end-date 2026-11-07',
        '<%= config.bin %> helpdesk activity -a agt_123 --start-date 2026-11-01 --end-date 2026-11-01 --timezone America/New_York --all --json'
    ]
    static override flags = HELPDESK_REPORT_FLAGS

    async run(): Promise<void> {
        const { flags } = await this.parse(HelpdeskActivity)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchPages<ActivitySegment>(
            (query) =>
                client.GET('/agents/{agentId}/helpdesk/activity', {
                    params: {
                        path: { agentId },
                        query: {
                            ...query,
                            startDate: flags['start-date'],
                            endDate: flags['end-date'],
                            timezone: flags.timezone ?? localTimezone()
                        }
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const rows = items.map((s) => ({
            id: s.id,
            operator: s.operator.name,
            kind: s.kind,
            ticket: s.ticketNumber === null ? '' : String(s.ticketNumber),
            startedAt: s.startedAt,
            endedAt: s.endedAt ?? ''
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
                `More results: rerun with --cursor ${last.pagination.cursor} and the same dates and time zone (or use --all)`
            )
        }
    }
}
