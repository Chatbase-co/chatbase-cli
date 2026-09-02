import fs from 'node:fs'
import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { fetchPages } from '../../client/paginate.js'
import { UsageError } from '../../errors/errors.js'

export default class ConversationsExport extends AgentCommand {
    static override summary =
        'Export conversations from every source, with full message history'
    static override description =
        'Export conversations with full message history, newest first.\n\n' +
        'This is the only endpoint that returns conversations from every ' +
        'source — the chat bubble and external integrations (Slack, WhatsApp, ' +
        'Instagram, Messenger, and the like) as well as API-created ones. ' +
        'Prefer it over `conversations list` whenever you need real traffic ' +
        'rather than just programmatically created conversations. Each item ' +
        'embeds its own `messages` array, so no follow-up `conversations get` ' +
        'or `messages list` call is needed (and neither works for ' +
        'bubble/integration conversations).'
    static override examples = [
        '<%= config.bin %> conversations export -a agt_123',
        '<%= config.bin %> conversations export -a agt_123 --all -o export.json',
        '<%= config.bin %> conversations export -a agt_123 --start-date 2024-01-01 --end-date 2024-01-31',
        '<%= config.bin %> conversations export -a agt_123 --include summary --source Widget,WhatsApp',
        '<%= config.bin %> conversations export -a agt_123 --conversation conv_123'
    ]
    // Export is a data-export command, not a display one: it always emits
    // the raw API JSON, in both pretty and --json mode (--plain/--json are
    // inherited but no-ops here — kept only so `-h` documents them like
    // every other command).
    static override flags = {
        ...AgentCommand.baseFlags,
        cursor: Flags.string({
            description: 'Opaque cursor from a previous response'
        }),
        // The API caps this endpoint at 20 per page — not the 100 that
        // ListCommand's shared --limit allows — which is why export declares
        // its own flag instead of inheriting that base.
        limit: Flags.integer({
            description: 'Items per page (1-20, default 20)',
            min: 1,
            max: 20
        }),
        all: Flags.boolean({ description: 'Fetch every page' }),
        output: Flags.string({
            char: 'o',
            description: 'Write export JSON to a file instead of stdout'
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
        }),
        // Named --conversation to match `conversations get`, though the query
        // param is conversationId.
        conversation: Flags.string({
            description:
                'Export only this conversation ID, from any source (widget, API, WhatsApp, …)'
        }),
        include: Flags.string({
            description:
                'Whether to embed message bodies; summary omits them for a cheaper triage pass',
            options: ['summary', 'messages']
        }),
        source: Flags.string({
            description:
                'Restrict to these conversation sources (comma-separated, e.g. "Widget or Iframe,WhatsApp"). Omit for all sources'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsExport)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const extraQuery: Record<string, unknown> = {}
        if (flags['start-date']) extraQuery.startDate = flags['start-date']
        if (flags['end-date']) extraQuery.endDate = flags['end-date']
        if (flags.conversation) extraQuery.conversationId = flags.conversation
        if (flags.include) extraQuery.include = flags.include
        if (flags.source) extraQuery.source = flags.source

        const { pages, items } = await fetchPages<Record<string, unknown>>(
            (query) =>
                client.GET('/agents/{agentId}/conversations/export', {
                    params: {
                        path: { agentId },
                        query: { ...query, ...extraQuery }
                    }
                }),
            { limit: flags.limit, cursor: flags.cursor, all: flags.all }
        )

        const last = pages.at(-1)
        // Single page stays byte-for-byte the API's envelope; --all merges
        // `data` across pages but keeps that same shape so downstream
        // consumers parse one thing either way.
        const raw =
            pages.length === 1
                ? pages[0]
                : { data: items, pagination: last?.pagination }
        const json = `${JSON.stringify(raw, null, 2)}\n`

        if (flags.output) {
            try {
                fs.writeFileSync(flags.output, json)
            } catch (e) {
                throw new UsageError(
                    `Cannot write to ${flags.output}: ${(e as NodeJS.ErrnoException).code ?? (e as Error).message}`
                )
            }
            this.success(flags, `Exported conversations to ${flags.output}`)
        } else {
            process.stdout.write(json)
        }
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
