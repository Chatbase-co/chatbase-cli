import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { rawApiFetch } from '../../client/client.js'
import { configFile } from '../../config/paths.js'
import { readUserConfig, writeUserConfig } from '../../config/store.js'
import { parseErrorResponse, UsageError } from '../../errors/errors.js'

async function readStdinToEnd(): Promise<string> {
    let data = ''
    for await (const chunk of process.stdin) data += chunk
    return data.trim()
}

export default class AuthLogin extends BaseCommand {
    static override description =
        'Authenticate with a Chatbase workspace API key'
    static override examples = [
        '<%= config.bin %> auth login',
        'cat key.txt | <%= config.bin %> auth login --with-token'
    ]
    static override flags = {
        ...BaseCommand.baseFlags,
        'with-token': Flags.boolean({
            description: 'Read the API key from stdin'
        })
    }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthLogin)

        let key: string
        if (flags['with-token']) {
            key = await readStdinToEnd()
            if (!key) throw new UsageError('No token received on stdin.')
        } else if (process.stdin.isTTY && !flags['no-input']) {
            this.note(
                flags,
                'Paste your API key (chatbase.co → Workspace Settings → API Keys)'
            )
            const { password } = await import('@inquirer/prompts')
            key = (await password({ message: 'Key:', mask: '●' })).trim()
            if (!key) throw new UsageError('No key entered.')
        } else {
            throw new UsageError(
                'Cannot prompt (no TTY or --no-input). Use: chatbase auth login --with-token < key.txt'
            )
        }

        const res = await rawApiFetch('GET', '/me', { apiKey: key })
        if (res.status === 200) {
            const body = res.body as {
                workspace?: { name?: string }
                plan?: string
            }
            writeUserConfig({ ...readUserConfig(), apiKey: key })
            this.success(
                flags,
                `Logged in${body.workspace?.name ? ` to workspace ${body.workspace.name}` : ''}`
            )
        } else if (res.status === 404) {
            writeUserConfig({ ...readUserConfig(), apiKey: key })
            this.note(
                flags,
                'Key stored (verification unavailable — it will be checked on first use).'
            )
        } else {
            throw parseErrorResponse(res.status, res.body, res.requestId)
        }
        this.note(flags, `Saved to ${configFile()}`)
    }
}
