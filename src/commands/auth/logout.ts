import fs from 'node:fs'
import { BaseCommand } from '../../base/base-command.js'
import { rawApiFetch } from '../../client/client.js'
import { configFile } from '../../config/paths.js'
import { readUserConfig } from '../../config/store.js'

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
            } catch (err) {
                const detail = err instanceof Error ? err.message : String(err)
                this.note(
                    flags,
                    this.palette(flags).yellow(
                        `! Could not reach the API to revoke the key (${detail}) — revoke it manually at chatbase.co if needed.`
                    )
                )
            }
        }

        fs.rmSync(configFile(), { force: true })
        this.success(flags, 'Logged out (stored config removed).')
    }
}
