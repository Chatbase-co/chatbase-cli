import { BaseCommand } from '../../base/base-command.js'
import {
    DEFAULT_BASE_URL,
    rawApiFetch,
    resolveBaseUrl
} from '../../client/client.js'
import { resolveApiKey } from '../../config/resolve.js'

export default class AuthStatus extends BaseCommand {
    static override description =
        'Show the active credential and where it comes from'
    static override examples = ['<%= config.bin %> auth status']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthStatus)
        // A silently overridden base URL would send the key elsewhere —
        // always surface it when active.
        const baseUrl = resolveBaseUrl()
        if (baseUrl !== DEFAULT_BASE_URL) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    `! API base overridden: ${baseUrl} (CHATBASE_API_URL)`
                )
            )
        }
        const resolved = resolveApiKey()
        if (!resolved) {
            this.note(flags, 'Not authenticated. Run `chatbase auth login`.')
            return
        }
        this.note(
            flags,
            `Credential: …${resolved.value.slice(-4)} (from ${resolved.source})`
        )
        const res = await rawApiFetch('GET', '/me', { apiKey: resolved.value })
        if (res.status === 200) {
            const body = res.body as {
                workspace?: { name?: string }
                plan?: string
            }
            this.note(
                flags,
                `Workspace: ${body.workspace?.name ?? 'unknown'} (plan: ${body.plan ?? 'unknown'})`
            )
        } else if (res.status === 401 || res.status === 403) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    '! Key appears invalid or lacks API access.'
                )
            )
        }
    }
}
