import { Flags } from '@oclif/core'
import { ListCommand } from './list-command.js'

/** Flags shared by `helpdesk attendance` and `helpdesk activity`, which take
 * the same query and paging rules. */
export const HELPDESK_REPORT_FLAGS = {
    ...ListCommand.baseFlags,
    limit: Flags.integer({
        description: 'Maximum items per page (1–1000, default 100)',
        min: 1,
        max: 1000
    }),
    cursor: Flags.string({
        description:
            'Pagination cursor from a previous page; repeat the same dates and time zone or the API rejects it'
    }),
    'start-date': Flags.string({
        description:
            'First day (YYYY-MM-DD) in --timezone; at most 396 days ago',
        required: true
    }),
    'end-date': Flags.string({
        description:
            'Last day (YYYY-MM-DD), inclusive; not after today and at most 31 days from --start-date counting both',
        required: true
    }),
    timezone: Flags.string({
        description:
            'IANA time zone that decides where each day starts (default: this machine’s time zone)'
    })
}

// Not a flag `default`: oclif would print the build machine's zone into README.
export const localTimezone = () =>
    Intl.DateTimeFormat().resolvedOptions().timeZone

export const HELPDESK_REPORT_NOTE =
    'Both reports share a limit of 30 calls per 10 seconds per account.'
