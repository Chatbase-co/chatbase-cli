import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'
import { type Column, formatEpochSeconds } from '../../output/render.js'

type Bucket = components['schemas']['AnalyticsBucket']

const COLUMNS: Column[] = [
    { key: 'start', header: 'START' },
    { key: 'end', header: 'END' },
    { key: 'conversations', header: 'CONVERSATIONS' },
    { key: 'messages', header: 'MESSAGES' },
    { key: 'positive', header: 'POSITIVE' },
    { key: 'neutral', header: 'NEUTRAL' },
    { key: 'negative', header: 'NEGATIVE' },
    { key: 'escalated', header: 'ESCALATED' },
    { key: 'thumbsUp', header: 'THUMBS_UP' },
    { key: 'thumbsDown', header: 'THUMBS_DOWN' }
]

const n = (v: number) => String(v)

function toRow(b: Bucket): Record<string, string> {
    return {
        start: formatEpochSeconds(b.start),
        end: formatEpochSeconds(b.end),
        conversations: n(b.conversations),
        messages: n(b.messages),
        positive: n(b.positive),
        neutral: n(b.neutral),
        negative: n(b.negative),
        escalated: n(b.escalated),
        thumbsUp: n(b.thumbsUp),
        thumbsDown: n(b.thumbsDown)
    }
}

export default class AgentsAnalytics extends AgentCommand {
    static override summary = 'Show an agent’s activity over a date range'
    static override description =
        'Splits the range into 7 equal buckets (oldest first) with conversations, messages, ' +
        'sentiment, escalations and ratings per bucket. Use --json for the full response: ' +
        'help desk tickets, procedure, tool and action counts per bucket, plus totals by ' +
        'source, tool, country, answer confidence, hour of day and credits per day.\n\n' +
        'Conversations count by last activity. The range must fall inside the searchable ' +
        'window (since the 1st of the month 12 months ago, UTC). ' +
        '--time-zone only affects conversationsByHour, which is approximate for zones with a ' +
        '30- or 45-minute offset.'
    static override examples = [
        '<%= config.bin %> agents analytics -a agt_123',
        '<%= config.bin %> agents analytics -a agt_123 --start-date 2026-10-01 --end-date 2026-10-31 --time-zone America/New_York --json'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        'start-date': Flags.string({
            description:
                'Range start (YYYY-MM-DD or ISO 8601); defaults to 7 days before --end-date'
        }),
        'end-date': Flags.string({
            description:
                'Range end (YYYY-MM-DD, inclusive, or ISO 8601); defaults to now and is capped to now'
        }),
        'time-zone': Flags.string({
            description:
                'IANA time zone for conversationsByHour, e.g. America/New_York (default UTC)'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(AgentsAnalytics)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/analytics',
            {
                params: {
                    path: { agentId },
                    query: {
                        ...(flags['start-date']
                            ? { startDate: flags['start-date'] }
                            : {}),
                        ...(flags['end-date']
                            ? { endDate: flags['end-date'] }
                            : {}),
                        ...(flags['time-zone']
                            ? { timeZone: flags['time-zone'] }
                            : {})
                    }
                }
            }
        )
        throwIfError(response, error)
        this.printData(flags, data, (data?.buckets ?? []).map(toRow), COLUMNS)
    }
}
