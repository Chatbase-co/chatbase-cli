import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { uploadFileSource } from '../../client/files.js'
import { resolveApiKey } from '../../config/resolve.js'
import { UsageError } from '../../errors/errors.js'
import { assertFileReadable } from './create.js'

export default class SourcesUpdate extends AgentCommand {
    static override description =
        'Update an existing source (text, qna, link, or file)'
    static override examples = [
        '<%= config.bin %> sources update src_1 --data \'{"type":"text","content":"new"}\' -a agt_1',
        '<%= config.bin %> sources update src_1 --file ./updated.pdf -a agt_1'
    ]
    static override args = {
        sourceId: Args.string({ required: true, description: 'Source ID' })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        data: Flags.string({
            description:
                'Full JSON body for JSON sources (text/qna/link) (@file, @-, or inline)',
            exclusive: ['file']
        }),
        file: Flags.string({
            description:
                'Path to a file to upload as a replacement (mutually exclusive with --data)',
            exclusive: ['data']
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(SourcesUpdate)
        if (!flags.data && !flags.file) {
            throw new UsageError(
                'Specify --data for JSON source updates, or --file to upload a replacement file.'
            )
        }
        // Validated before any network call, including agent-name
        // resolution below — matches the guard in sources/create.ts.
        if (flags.file) assertFileReadable(flags.file)

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        if (flags.file) {
            const resolved = resolveApiKey()
            if (!resolved) {
                throw new UsageError(
                    'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
                )
            }
            await uploadFileSource({
                agentId,
                filePath: flags.file,
                sourceId: args.sourceId,
                apiKey: resolved.value
            })
        } else {
            const body = await readBodyData(flags.data)
            const { error, response } = await client.PUT(
                '/agents/{agentId}/sources/{sourceId}',
                {
                    params: { path: { agentId, sourceId: args.sourceId } },
                    body: body as never
                }
            )
            throwIfError(response, error)
        }

        this.success(flags, `Updated source ${args.sourceId}`)
    }
}
