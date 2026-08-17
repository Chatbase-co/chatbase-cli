import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HelpdeskStatuses from '../../src/commands/helpdesk/statuses.js'
import HelpdeskTeams from '../../src/commands/helpdesk/teams.js'
import TicketsCreate from '../../src/commands/tickets/create.js'
import TicketsGet from '../../src/commands/tickets/get.js'
import TicketsList from '../../src/commands/tickets/list.js'
import TicketsMessages from '../../src/commands/tickets/messages.js'
import TicketsReply from '../../src/commands/tickets/reply.js'
import TicketsUpdate from '../../src/commands/tickets/update.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

function bodyText(body: unknown): string {
    if (body == null) return ''
    if (typeof body === 'string') return body
    if (body instanceof Uint8Array) return Buffer.from(body).toString('utf8')
    return String(body)
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
    vi.stubEnv('CHATBASE_API_KEY', 'sk-test')
    vi.stubEnv('CHATBASE_AGENT_ID', 'agt_1')
    vi.stubEnv(
        'XDG_CONFIG_HOME',
        fs.mkdtempSync(path.join(os.tmpdir(), 'cb-tickets-'))
    )
})

afterEach(async () => {
    await mock.close()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

const ticketListItem = {
    ticketNumber: 42,
    subject: 'Refund broken',
    statusCategory: 'on_customer',
    statusId: 'st_1',
    assigneeId: null,
    customer: {
        id: 'cust_1',
        name: 'Ada',
        email: 'ada@example.com',
        phoneNumber: null
    },
    channel: 'email',
    conversationId: null,
    teamId: null,
    createdAt: '2026-07-20T12:34:56.000Z',
    updatedAt: '2026-07-21T09:00:00.000Z',
    lastMessageAt: null
}

describe('chatbase tickets list', () => {
    it('renders a plain row with ticketNumber, subject, statusCategory, channel, createdAt', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets',
                method: 'GET'
            })
            .reply(200, {
                data: [ticketListItem],
                pagination: { cursor: null, hasMore: false }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await TicketsList.run(['--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '42\tRefund broken\ton_customer\temail\t2026-07-20T12:34:56.000Z'
        )
    })
})

describe('chatbase tickets get', () => {
    const ticket = { ...ticketListItem, description: 'Customer cannot export.' }

    it('--json emits the raw Ticket response', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42',
                method: 'GET'
            })
            .reply(200, ticket)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await TicketsGet.run(['42', '--json'], process.cwd())
        expect(
            JSON.parse(out.mock.calls.map((c) => String(c[0])).join(''))
        ).toEqual(ticket)
    })
})

describe('chatbase tickets create', () => {
    it('POSTs a merged body and prints the bare ticket number', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return { ...ticketListItem, ticketNumber: 99 }
            })
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsCreate.run(
            [
                '--subject',
                'Refund broken',
                '--data',
                '{"description":"Customer cannot export.","customer":{"email":"jane@example.com"}}'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            subject: 'Refund broken',
            description: 'Customer cannot export.',
            customer: { email: 'jane@example.com' }
        })
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toBe('99\n')
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('99')
    })

    it('--customer-email and --customer-name build the customer object', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return { ...ticketListItem, ticketNumber: 100 }
            })
        vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsCreate.run(
            [
                '--subject',
                'Refund broken',
                '-f',
                'description=Customer cannot export.',
                '--customer-email',
                'jane@example.com',
                '--customer-name',
                'Jane'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            subject: 'Refund broken',
            description: 'Customer cannot export.',
            customer: { email: 'jane@example.com', name: 'Jane' }
        })
    })

    it('--customer-name without --customer-email is a usage error', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsCreate.run(
                ['--subject', 'X', '--customer-name', 'Jane'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('chatbase tickets update', () => {
    it('PATCHes the --data body verbatim', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42',
                method: 'PATCH'
            })
            .reply(200, (opts) => {
                sentBody = bodyText(opts.body)
                return { ...ticketListItem, statusId: 'st_2' }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsUpdate.run(
            ['42', '--data', '{"statusId":"st_2"}'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({ statusId: 'st_2' })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('42')
    })
})

describe('chatbase tickets messages', () => {
    const page1 = {
        data: [
            {
                id: 'msg_1',
                type: 'reply',
                sender: {
                    type: 'customer',
                    id: 'cust_1',
                    name: 'Ada',
                    email: 'ada@example.com'
                },
                content: '<p>Hi</p>',
                contentText: 'Hi',
                attachments: [],
                createdAt: '2026-07-25T10:15:00.000Z'
            }
        ],
        pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
    }
    const page2 = {
        data: [
            {
                id: 'msg_2',
                type: 'reply',
                sender: {
                    type: 'agent',
                    id: 'usr_1',
                    name: 'Sam',
                    email: 'sam@example.com'
                },
                content: '<p>On it</p>',
                contentText: 'On it',
                attachments: [],
                createdAt: '2026-07-25T10:20:00.000Z'
            }
        ],
        pagination: { cursor: null, hasMore: false, total: 2 }
    }

    it('renders rows with columns id, type, sender, content, createdAt', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsMessages.run(['--ticket', '42', '--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'msg_1\treply\tAda\tHi\t2026-07-25T10:15:00.000Z'
        )
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            '--cursor cur_2'
        )
    })

    it('accepts the ticket number positionally', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
                method: 'GET'
            })
            .reply(200, page1)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsMessages.run(['42', '--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'msg_1'
        )
    })

    it('rejects positional and --ticket together', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsMessages.run(
                ['42', '--ticket', '42', '--plain'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'not both'
        )
    })

    it('names both forms when the ticket number is missing', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsMessages.run(['--plain'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'positionally'
        )
    })

    it('--all follows pagination to the end', async () => {
        const pool = mock.get(BASE)
        pool.intercept({
            path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
            method: 'GET'
        }).reply(200, page1)
        pool.intercept({
            path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, page2)
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsMessages.run(
            ['--ticket', '42', '--plain', '--all'],
            process.cwd()
        )
        const printed = out.mock.calls.map((c) => String(c[0])).join('')
        expect(printed).toContain('msg_1')
        expect(printed).toContain('msg_2')
    })
})

describe('chatbase tickets reply', () => {
    it('POSTs {type, content, authorEmail} and prints a success note', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return {
                    id: 'msg_3',
                    type: 'reply',
                    sender: {
                        type: 'agent',
                        id: 'usr_1',
                        name: 'Sam',
                        email: 'sam@example.com'
                    },
                    content: '<p>On it</p>',
                    contentText: 'On it',
                    createdAt: '2026-07-25T10:25:00.000Z'
                }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsReply.run(
            [
                '--ticket',
                '42',
                '-m',
                'On it',
                '--author-email',
                'sam@example.com'
            ],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            type: 'reply',
            content: 'On it',
            authorEmail: 'sam@example.com'
        })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('42')
    })

    it('accepts the ticket number positionally', async () => {
        let sentBody = ''
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/tickets/42/messages',
                method: 'POST'
            })
            .reply(201, (opts) => {
                sentBody = bodyText(opts.body)
                return { id: 'msg_4', type: 'reply' }
            })
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await TicketsReply.run(
            ['42', '-m', 'On it', '--author-email', 'sam@example.com'],
            process.cwd()
        )
        expect(JSON.parse(sentBody)).toEqual({
            type: 'reply',
            content: 'On it',
            authorEmail: 'sam@example.com'
        })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain('42')
    })

    it('rejects positional and --ticket together', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsReply.run(
                [
                    '42',
                    '--ticket',
                    '42',
                    '-m',
                    'On it',
                    '--author-email',
                    'sam@example.com'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'not both'
        )
    })

    it('names both forms when the ticket number is missing', async () => {
        const err = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsReply.run(
                ['-m', 'On it', '--author-email', 'sam@example.com'],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
        expect(err.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'positionally'
        )
    })

    it('rejects when both --author-id and --author-email are given', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsReply.run(
                [
                    '--ticket',
                    '42',
                    '-m',
                    'On it',
                    '--author-id',
                    'usr_1',
                    '--author-email',
                    'sam@example.com'
                ],
                process.cwd()
            )
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })

    it('rejects when neither --author-id nor --author-email is given', async () => {
        vi.spyOn(process.stderr, 'write').mockReturnValue(true)
        await expect(
            TicketsReply.run(['--ticket', '42', '-m', 'On it'], process.cwd())
        ).rejects.toMatchObject({ oclif: { exit: 2 } })
    })
})

describe('chatbase helpdesk teams', () => {
    it('renders a plain id/name table', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/teams',
                method: 'GET'
            })
            .reply(200, [
                {
                    id: 'team_1',
                    name: 'Support',
                    isDefault: true,
                    memberCount: 3
                }
            ])
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await HelpdeskTeams.run(['--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'team_1\tSupport'
        )
    })
})

describe('chatbase helpdesk statuses', () => {
    it('renders a plain id/category/label table', async () => {
        mock.get(BASE)
            .intercept({
                path: '/api/v2/agents/agt_1/helpdesk/ticket-statuses',
                method: 'GET'
            })
            .reply(200, [
                {
                    id: 'st_1',
                    category: 'new',
                    externalLabel: 'New',
                    internalLabel: 'New',
                    color: '#2563EB',
                    isDefault: true,
                    position: 0
                }
            ])
        const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true)
        await HelpdeskStatuses.run(['--plain'], process.cwd())
        expect(out.mock.calls.map((c) => String(c[0])).join('')).toContain(
            'st_1\tnew\tNew'
        )
    })
})
