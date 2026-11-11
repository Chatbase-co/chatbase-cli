import {
    HELPDESK_REPORT_FLAGS,
    HELPDESK_REPORT_NOTE,
    localTimezone
} from '../../base/helpdesk-report.js'
import { ListCommand } from '../../base/list-command.js'
import { fetchPages } from '../../client/paginate.js'
import type { components } from '../../generated/api.js'
import type { Column } from '../../output/render.js'

type AttendanceRow = components['schemas']['AttendanceRow']

const COLUMNS: Column[] = [
    { key: 'date', header: 'DATE' },
    { key: 'operator', header: 'OPERATOR' },
    { key: 'shift', header: 'SHIFT' },
    { key: 'scheduledStart', header: 'SCHEDULED START' },
    { key: 'scheduledEnd', header: 'SCHEDULED END' },
    { key: 'loggedStart', header: 'LOGGED START' },
    { key: 'loggedEnd', header: 'LOGGED END' },
    { key: 'loggedMinutes', header: 'LOGGED MIN' },
    { key: 'adherence', header: 'ADHERENCE %' }
]

const str = (v: string | number | null) => (v === null ? '' : String(v))

export default class HelpdeskAttendance extends ListCommand {
    static override summary = 'Show the Help Desk attendance report'
    static override description =
        'One row per operator for each part of a shift, and for time logged ' +
        'outside shifts, per calendar day in --timezone. Matches the ' +
        'dashboard’s Attendance CSV export. A day that has not ended yet ' +
        'shows what has happened so far. Use --json for every metric. ' +
        HELPDESK_REPORT_NOTE
    static override examples = [
        '<%= config.bin %> helpdesk attendance -a agt_123 --start-date 2026-11-01 --end-date 2026-11-07',
        '<%= config.bin %> helpdesk attendance -a agt_123 --start-date 2026-11-01 --end-date 2026-11-30 --timezone Europe/Berlin --all --json'
    ]
    static override flags = HELPDESK_REPORT_FLAGS

    async run(): Promise<void> {
        const { flags } = await this.parse(HelpdeskAttendance)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchPages<AttendanceRow>(
            (query) =>
                client.GET('/agents/{agentId}/helpdesk/attendance', {
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

        const rows = items.map((r) => ({
            date: r.date,
            operator: r.operator.name,
            shift: str(r.shiftName),
            scheduledStart: str(r.scheduledStart),
            scheduledEnd: str(r.scheduledEnd),
            loggedStart: str(r.loggedStart),
            loggedEnd: str(r.loggedEnd),
            loggedMinutes: str(r.timeLoggedMinutes),
            adherence: str(r.adherencePercent)
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
