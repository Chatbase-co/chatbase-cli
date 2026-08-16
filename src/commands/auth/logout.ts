import { BaseCommand } from '../../base/base-command.js'
import { createApiClient } from '../../client/client.js'
import { readUserConfig, writeUserConfig } from '../../config/store.js'

export default class AuthLogout extends BaseCommand {
    static override description =
        'Remove the stored API key (revokes CLI-paired keys server-side)'
    static override examples = ['<%= config.bin %> auth logout']

    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthLogout)
        const config = readUserConfig()
        if (!config.apiKey) {
            this.note(flags, 'No stored credential — nothing to remove.')
            return
        }

        // Pairing keys belong to this device — revoke server-side (best
        // effort; local delete happens either way). Pasted keys may be
        // shared with CI/teammates, so they're removed locally only.
        if (config.apiKeySource === 'pairing') {
            try {
                const client = createApiClient({ apiKey: config.apiKey })
                const { response } = await client.DELETE('/me/credential')
                if (response.ok) {
                    this.note(flags, 'CLI session revoked server-side.')
                } else {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Could not revoke the key server-side (${response.status}) — revoke it manually at chatbase.co if needed.`
                        )
                    )
                }
            } catch {
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        '! Could not reach the API to revoke the key — revoke it manually at chatbase.co if needed.'
                    )
                )
            }
        }

        const { apiKey: _removed, apiKeySource: _src, ...rest } = config
        writeUserConfig(rest)
        this.success(flags, 'Logged out (stored key removed).')
    }
}
