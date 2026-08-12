import fs from 'node:fs'
import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'

export default class ConversationsExport extends AgentCommand {
    static override description =
        'Export conversations with full message history'
    static override examples = [
        '<%= config.bin %> conversations export -a agt_123',
        '<%= config.bin %> conversations export -a agt_123 -o export.json'
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
        limit: Flags.integer({
            description: 'Items per page (1-20, default 20)',
            min: 1,
            max: 20
        }),
        output: Flags.string({
            char: 'o',
            description: 'Write export JSON to a file instead of stdout'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ConversationsExport)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.GET(
            '/agents/{agentId}/conversations/export',
            {
                params: {
                    path: { agentId },
                    query: { cursor: flags.cursor, limit: flags.limit }
                }
            }
        )
        throwIfError(response, error)
        const json = `${JSON.stringify(data, null, 2)}\n`
        if (flags.output) {
            fs.writeFileSync(flags.output, json)
            this.success(flags, `Exported conversations to ${flags.output}`)
        } else {
            process.stdout.write(json)
        }
    }
}
