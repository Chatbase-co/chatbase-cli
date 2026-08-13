import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { assertFileReadable } from '../../base/assert-file.js'
import { readBodyData, readTextInput } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { uploadFileSource } from '../../client/files.js'
import { resolveApiKey } from '../../config/resolve.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type CreateSourceBody = components['schemas']['CreateSourceBody']

type CreateFlags = {
    type?: string
    file?: string
    name?: string
    content?: string
    url?: string
    'link-type'?: string
    data?: string
    field?: string[]
}

/** Merges --data (base) with per-type flags (win). Link fields default to
 * empty/false because the API schema marks them required despite having defaults. */
async function buildSourceBody(
    flags: CreateFlags
): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = {
        ...(await readBodyData(flags.data, flags.field)),
        type: flags.type
    }
    if (flags.type === 'text') {
        if (flags.name) body.name = flags.name
        if (flags.content) body.content = await readTextInput(flags.content)
    } else if (flags.type === 'qna') {
        if (flags.name) body.name = flags.name
    } else if (flags.type === 'link') {
        if (flags.url) body.url = flags.url
        if (flags['link-type']) body.linkType = flags['link-type']
        body.excludePaths ??= []
        body.includeOnlyPaths ??= []
        body.slowScraping ??= false
    }
    return body
}

export default class SourcesCreate extends AgentCommand {
    static override description =
        'Create a source: text/qna/link (JSON) or a file upload'
    static override examples = [
        '<%= config.bin %> sources create --type text --name Guide --content "hello" -a agt_123',
        '<%= config.bin %> sources create --type link --url https://example.com --link-type crawl -a agt_123',
        '<%= config.bin %> sources create --type qna --data \'{"questions":["Q1"],"answer":"A1"}\' -a agt_123',
        '<%= config.bin %> sources create --file ./guide.pdf -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        type: Flags.string({
            options: ['text', 'qna', 'link'],
            description: 'JSON source type (mutually exclusive with --file)',
            exclusive: ['file']
        }),
        file: Flags.string({
            description:
                'Path to a file to upload as a source (mutually exclusive with --type)',
            exclusive: ['type']
        }),
        name: Flags.string({
            description: 'Source name (--type text/qna, or a file upload)'
        }),
        content: Flags.string({
            description: 'Text content for --type text (@file, @-, or inline)'
        }),
        url: Flags.string({ description: 'URL for --type link' }),
        'link-type': Flags.string({
            options: ['individual', 'sitemap', 'crawl'],
            description: 'Link crawl mode for --type link'
        }),
        data: Flags.string({
            description:
                'JSON body (@file, @-, or inline); per-type flags override matching keys'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(SourcesCreate)
        if (!flags.type && !flags.file) {
            throw new UsageError(
                'Specify --type <text|qna|link> for a JSON source, or --file <path> to upload a file.'
            )
        }
        // Validated before any network call, including agent-name resolution below.
        if (flags.file) assertFileReadable(flags.file)

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)

        let id: string
        if (flags.file) {
            const resolved = resolveApiKey()
            if (!resolved) {
                // Unreachable in practice: this.apiClient() above already
                // required auth and would have thrown first.
                throw new UsageError(
                    'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
                )
            }
            const uploaded = await uploadFileSource({
                agentId,
                filePath: flags.file,
                name: flags.name,
                apiKey: resolved.value
            })
            id = uploaded.id
        } else {
            const body = await buildSourceBody(flags)
            const { data, error, response } = await client.POST(
                '/agents/{agentId}/sources',
                {
                    params: { path: { agentId } },
                    body: body as CreateSourceBody
                }
            )
            throwIfError(response, error)
            id = (data as { id: string }).id
        }

        this.success(flags, `Created source ${id} (untrained)`)
        this.note(flags, `→ chatbase sources get ${id} -a ${agentId}`)
        process.stdout.write(`${id}\n`)
    }
}
