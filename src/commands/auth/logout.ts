import fs from 'node:fs'
import { BaseCommand } from '../../base/base-command.js'
import { configFile } from '../../config/paths.js'
import { readUserConfig } from '../../config/store.js'

export default class AuthLogout extends BaseCommand {
    static override description = 'Remove the stored API key'
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
        fs.rmSync(configFile(), { force: true })
        this.success(flags, 'Logged out (stored config removed).')
    }
}
