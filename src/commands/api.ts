import { Args, Flags } from '@oclif/core'
import { BaseCommand, bodyFieldFlags } from '../base/base-command.js'
import { parseFields, readBodyData } from '../base/body-input.js'
import { rawApiFetch } from '../client/client.js'
import { resolveApiKey } from '../config/resolve.js'
import { parseErrorResponse, UsageError } from '../errors/errors.js'

/** k=v -> [k, v], splitting only on the first '=' so values containing '='
 * (base64, JSON snippets, etc.) survive intact. */
function parseField(field: string): [string, string] {
    const idx = field.indexOf('=')
    if (idx === -1) {
        throw new UsageError(`--field must be key=value (got "${field}")`)
    }
    return [field.slice(0, idx), field.slice(idx + 1)]
}

export default class Api extends BaseCommand {
    static override description =
        'Call the Chatbase API directly — an escape hatch for endpoints without a dedicated command'
    static override examples = [
        '<%= config.bin %> api GET /agents',
        '<%= config.bin %> api GET /agents --field limit=5',
        '<%= config.bin %> api POST /agents --body \'{"name":"Support Bot"}\'',
        '<%= config.bin %> api PATCH /agents/agt_123 --body @patch.json'
    ]
    static override args = {
        method: Args.string({
            required: true,
            options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
            description: 'HTTP method'
        }),
        path: Args.string({
            required: true,
            description: 'API path relative to /api/v2, e.g. /agents'
        })
    }
    static override flags = {
        ...BaseCommand.baseFlags,
        ...bodyFieldFlags,
        query: Flags.string({
            multiple: true,
            description: 'Query param k=v (repeatable)'
        }),
        body: Flags.string({
            description: 'JSON request body (@file, @-, or inline JSON)'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(Api)

        const resolved = resolveApiKey()
        if (!resolved) {
            throw new UsageError(
                'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
            )
        }

        const query = (flags.query ?? []).map(parseField)
        const bodyData = flags.body
            ? await readBodyData(flags.body, flags.field)
            : parseFields(flags.field)
        const hasBody = Object.keys(bodyData).length > 0

        const res = await rawApiFetch(args.method, args.path, {
            apiKey: resolved.value,
            query,
            body: hasBody ? bodyData : undefined
        })
        if (res.status >= 400) {
            throw parseErrorResponse(res.status, res.body, res.requestId)
        }
        // The escape hatch IS raw by design — always the exact response JSON,
        // regardless of --json/--plain/pretty.
        process.stdout.write(`${JSON.stringify(res.body, null, 2)}\n`)
    }
}
