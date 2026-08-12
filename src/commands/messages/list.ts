import { Flags } from '@oclif/core'
import { ListCommand } from '../../base/list-command.js'
import { throwIfError } from '../../client/client.js'
import type { Column } from '../../output/render.js'

const COLUMNS: Column[] = [
    { key: 'id', header: 'ID' },
    { key: 'role', header: 'ROLE' },
    { key: 'createdAt', header: 'CREATED' }
]

export default class MessagesList extends ListCommand {
    static override description = 'List messages in a conversation'
    static override examples = [
        '<%= config.bin %> messages list --conversation conv_123 -a agt_123',
        '<%= config.bin %> messages list --conversation conv_123 -a agt_123 --all --json'
    ]
    static override flags = {
        ...ListCommand.baseFlags,
        conversation: Flags.string({
            required: true,
            description: 'Conversation ID'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(MessagesList)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        type Page = {
            data: Array<Record<string, string>>
            pagination: {
                cursor?: string | null
                hasMore: boolean
                total: number
            }
        }

        const pages: Page[] = []
        let cursor = flags.cursor
        for (;;) {
            const { data, error, response } = await client.GET(
                '/agents/{agentId}/conversations/{conversationId}/messages',
                {
                    params: {
                        path: {
                            agentId,
                            conversationId: flags.conversation
                        },
                        query: { cursor, limit: flags.limit }
                    }
                }
            )
            throwIfError(response, error)
            const page = data as unknown as Page
            pages.push(page)
            if (
                !flags.all ||
                !page.pagination.hasMore ||
                !page.pagination.cursor
            )
                break
            cursor = page.pagination.cursor
        }

        const rows = pages.flatMap((p) =>
            p.data.map((m) => ({
                id: String(m.id ?? ''),
                role: String(m.role ?? ''),
                createdAt: String(m.createdAt ?? '')
            }))
        )
        const last = pages.at(-1)
        // --json must stay the raw API shape even when --all merges pages
        const raw =
            pages.length === 1
                ? pages[0]
                : {
                      data: pages.flatMap((p) => p.data),
                      pagination: last?.pagination
                  }

        this.printData(flags, raw, rows, COLUMNS)
        if (!flags.all && last?.pagination.hasMore && last.pagination.cursor) {
            this.note(
                flags,
                `More results: rerun with --cursor ${last.pagination.cursor} (or use --all)`
            )
        }
    }
}
