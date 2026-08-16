import { BaseCommand } from '../../base/base-command.js'
import { rawApiFetch } from '../../client/client.js'
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

        // Pairing-minted keys belong to this device alone, so logout ends the
        // session server-side too. Pasted keys may be shared (CI, teammates)
        // and are only removed locally. Revocation is best-effort: the local
        // key is deleted either way, and a failed revoke must not block that.
        // rawApiFetch because DELETE /me/credential is not in the vendored
        // spec yet — switch to the typed client on the next spec refresh.
        if (config.apiKeySource === 'pairing') {
            try {
                const res = await rawApiFetch('DELETE', '/me/credential', {
                    apiKey: config.apiKey
                })
                if (res.status >= 200 && res.status < 300) {
                    this.note(flags, 'CLI session revoked server-side.')
                } else {
                    this.note(
                        flags,
                        this.palette(flags).yellow(
                            `! Could not revoke the key server-side (${res.status}) — revoke it manually at chatbase.co if needed.`
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
