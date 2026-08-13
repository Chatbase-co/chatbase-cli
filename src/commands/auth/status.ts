import { BaseCommand } from '../../base/base-command.js'
import {
    createApiClient,
    DEFAULT_BASE_URL,
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
        const tail =
            resolved.value.length > 8 ? `…${resolved.value.slice(-4)}` : '…****'
        this.note(flags, `Credential: ${tail} (from ${resolved.source})`)

        const client = createApiClient({ apiKey: resolved.value })
        const { data, error, response } = await client.GET('/me')
        if (response.ok) {
            const body = data as {
                workspace?: { id?: string; name?: string }
                plan?: string
                credential?: {
                    source?: string | null
                    expiresAt?: string | null
                    permissions?: string[] | null
                }
            }
            this.note(
                flags,
                `Workspace: ${body.workspace?.name ?? 'unknown'} (plan: ${body.plan ?? 'unknown'})`
            )
            const cred = body.credential
            if (cred?.source === 'cli') {
                this.note(flags, 'Key type: CLI-paired device')
            }
            if (cred?.expiresAt) {
                const remaining = Math.ceil(
                    (new Date(cred.expiresAt).getTime() - Date.now()) /
                        (1000 * 60 * 60 * 24)
                )
                if (remaining <= 0) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            '! Already expired — re-pair with `chatbase auth login --browser`'
                        )
                    )
                } else if (remaining <= 7) {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Expires in ${remaining} day${remaining !== 1 ? 's' : ''} — re-pair with \`chatbase auth login --browser\``
                        )
                    )
                } else {
                    this.note(
                        flags,
                        `Expires in ${remaining} day${remaining !== 1 ? 's' : ''}`
                    )
                }
            }
            if (cred?.permissions) {
                this.note(
                    flags,
                    `Scopes: ${cred.permissions.join(', ') || 'none'}`
                )
            } else if (cred?.permissions === null) {
                this.note(flags, 'Scopes: full access')
            }
        } else if (response.status === 401 || response.status === 403) {
            const errBody = error as {
                error?: { code?: string }
            } | null
            const code = errBody?.error?.code
            if (code === 'API_KEY_EXPIRED') {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key has expired — re-pair with `chatbase auth login --browser`'
                    )
                )
            } else if (code === 'PERMISSION_DENIED') {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key lacks permission for this operation. Check scopes with your workspace admin.'
                    )
                )
            } else {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Key appears invalid or lacks API access.'
                    )
                )
            }
        } else if (!response.ok) {
            this.note(
                flags,
                this.palette(flags).yellow(
                    `! Could not verify key (server returned ${response.status})`
                )
            )
        }
    }
}
