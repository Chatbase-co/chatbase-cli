import fs from 'node:fs'
import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { fetchPages } from '../../client/paginate.js'

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
        '<%= config.bin %> conversations export -a agt_123 --all -o export.json'
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
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsExport)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        const { pages, items } = await fetchPages<Record<string, unknown>>(
            (query) =>
                client.GET('/agents/{agentId}/conversations/export', {
                    params: { path: { agentId }, query }
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
            fs.writeFileSync(flags.output, json)
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
