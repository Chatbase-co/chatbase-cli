import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HelpdeskActivity from '../../src/commands/helpdesk/activity.js'
import HelpdeskAttendance from '../../src/commands/helpdesk/attendance.js'

const BASE = 'https://www.chatbase.co'
const ATTENDANCE = '/api/v2/agents/agt_1/helpdesk/attendance'
const ACTIVITY = '/api/v2/agents/agt_1/helpdesk/activity'
const RANGE = { startDate: '2026-11-01', endDate: '2026-11-07' }
const RANGE_ARGS = ['--start-date', '2026-11-01', '--end-date', '2026-11-07']
let mock: MockAgent

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-helpdesk-reports-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const operator = { id: 'op_1', name: 'Dana', email: 'dana@example.com' }
const nullMetrics = {
    timeScheduledMinutes: null,
    timeLoggedMinutes: null,
    productiveTimeMinutes: null,
    breaksMinutes: null,
    lateMinutes: null,
    leftEarlyMinutes: null,
    overtimeMinutes: null,
    occupancyPercent: null,
    adherencePercent: null,
    conformancePercent: null,
    utilizationPercent: null
}
const offShiftRow = {
    date: '2026-11-02',
    operator,
    teams: [],
    shiftNumber: 1,
    shiftCount: 1,
    shiftName: null,
    scheduledStart: null,
    scheduledEnd: null,
    loggedStart: null,
    loggedEnd: null,
    sessions: [],
    unplannedTimeOff: false,
    plannedTimeOff: false,
    ...nullMetrics
}
const shiftRow = {
    ...offShiftRow,
    shiftName: 'Morning',
    scheduledStart: '09:00',
    scheduledEnd: '17:00',
    loggedStart: '09:05',
    loggedEnd: '17:00',
    timeLoggedMinutes: 475,
    adherencePercent: 98.5
}
const openSegment = {
    id: 'seg_1',
    operator,
    kind: 'untracked',
    ticketNumber: null,
    startedAt: '2026-11-02T09:05:00.000Z',
    lastSeenAt: '2026-11-02T09:10:00.000Z',
    endedAt: null
}

function stdout() {
    return vi.spyOn(process.stdout, 'write').mockReturnValue(true)
}
const joined = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls.map((c) => String(c[0])).join('')

describe('chatbase helpdesk attendance', () => {
    it('sends dates and timezone under spec names and blanks null metrics', async () => {
        mock.get(BASE)
            .intercept({
                path: ATTENDANCE,
                method: 'GET',
                query: { ...RANGE, timezone: 'Europe/Berlin', limit: '500' }
            })
            .reply(200, {
                data: [shiftRow, offShiftRow],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await HelpdeskAttendance.run(
            [
                ...RANGE_ARGS,
                '--timezone',
                'Europe/Berlin',
                '--limit',
                '500',
                '--plain'
            ],
            process.cwd()
        )
        const text = joined(out)
        expect(text).toContain(
            '2026-11-02\tDana\tMorning\t09:00\t17:00\t09:05\t17:00\t475\t98.5'
        )
        expect(text).toContain('2026-11-02\tDana\t\t\t\t\t\t\t')
    })

    it('defaults --timezone to the machine time zone', async () => {
        mock.get(BASE)
            .intercept({
                path: ATTENDANCE,
                method: 'GET',
                query: {
                    ...RANGE,
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                }
            })
            .reply(200, {
                data: [],
                pagination: { cursor: null, hasMore: false }
            })
        stdout()
        await HelpdeskAttendance.run([...RANGE_ARGS, '--json'], process.cwd())
    })

    it('requires --start-date and --end-date', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            HelpdeskAttendance.run(
                ['--start-date', '2026-11-01'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('accepts --limit up to 1000 and rejects 1001', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            HelpdeskAttendance.run(
                [...RANGE_ARGS, '--limit', '1001'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('explains HELPDESK_NOT_ENABLED', async () => {
        mock.get(BASE)
            .intercept({
                path: ATTENDANCE,
                method: 'GET',
                query: { ...RANGE, timezone: 'UTC' }
            })
            .reply(403, {
                error: {
                    code: 'HELPDESK_NOT_ENABLED',
                    message: 'Help desk is not enabled for this agent'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            HelpdeskAttendance.run(
                [...RANGE_ARGS, '--timezone', 'UTC'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 1 } })
        expect(joined(err)).toContain('Enable it in the agent')
    })
})

describe('chatbase helpdesk activity', () => {
    it('renders an open segment with blank ticket and end', async () => {
        mock.get(BASE)
            .intercept({
                path: ACTIVITY,
                method: 'GET',
                query: { ...RANGE, timezone: 'UTC' }
            })
            .reply(200, {
                data: [
                    openSegment,
                    {
                        ...openSegment,
                        id: 'seg_2',
                        kind: 'ticket',
                        ticketNumber: 42,
                        endedAt: '2026-11-02T10:00:00.000Z'
                    }
                ],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await HelpdeskActivity.run(
            [...RANGE_ARGS, '--timezone', 'UTC', '--plain'],
            process.cwd()
        )
        const text = joined(out)
        expect(text).toContain(
            'seg_1\tDana\tuntracked\t\t2026-11-02T09:05:00.000Z\t\n'
        )
        expect(text).toContain(
            'seg_2\tDana\tticket\t42\t2026-11-02T09:05:00.000Z\t2026-11-02T10:00:00.000Z'
        )
    })

    it('--all keeps the same filters and pages through an empty page', async () => {
        const q = { ...RANGE, timezone: 'UTC' }
        mock.get(BASE)
            .intercept({ path: ACTIVITY, method: 'GET', query: q })
            .reply(200, {
                data: [],
                pagination: { cursor: 'c1', hasMore: true }
            })
        mock.get(BASE)
            .intercept({
                path: ACTIVITY,
                method: 'GET',
                query: { ...q, cursor: 'c1' }
            })
            .reply(200, {
                data: [openSegment],
                pagination: { cursor: null, hasMore: false }
            })
        const out = stdout()
        await HelpdeskActivity.run(
            [...RANGE_ARGS, '--timezone', 'UTC', '--all', '--json'],
            process.cwd()
        )
        expect(JSON.parse(joined(out))).toEqual({
            data: [openSegment],
            pagination: { cursor: null, hasMore: false }
        })
    })
})
