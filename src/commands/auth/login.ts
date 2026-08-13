import { spawn } from 'node:child_process'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { createApiClient, throwIfError } from '../../client/client.js'
import { pollExchange, startPairing } from '../../client/pairing.js'
import { configFile } from '../../config/paths.js'
import { readUserConfig, writeUserConfig } from '../../config/store.js'
import { UsageError } from '../../errors/errors.js'

async function readStdinToEnd(): Promise<string> {
    let data = ''
    process.stdin.setEncoding('utf8')
    for await (const chunk of process.stdin) data += chunk
    return data.trim()
}

function tryOpenBrowser(url: string): void {
    try {
        if (process.platform === 'win32') {
            // `start` is a cmd.exe built-in, not a standalone executable —
            // spawning it directly throws ENOENT. Run it through cmd.exe
            // instead; the empty '' arg keeps `start` from treating the URL
            // as the window title.
            spawn('cmd', ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore'
            }).unref()
            return
        }
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        spawn(cmd, [url], { detached: true, stdio: 'ignore' }).unref()
    } catch {
        // Browser open is best-effort — the URL is printed to stderr anyway.
    }
}

export default class AuthLogin extends BaseCommand {
    static override description =
        'Authenticate with Chatbase — paste an API key or log in via browser'
    static override examples = [
        '<%= config.bin %> auth login',
        '<%= config.bin %> auth login --browser',
        'cat key.txt | <%= config.bin %> auth login --with-token'
    ]
    static override flags = {
        ...BaseCommand.baseFlags,
        'with-token': Flags.boolean({
            description: 'Read the API key from stdin'
        }),
        browser: Flags.boolean({
            description:
                'Log in via browser — approve a code at chatbase.co/activate'
        })
    }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(AuthLogin)

        if (flags['with-token']) {
            if (process.stdin.isTTY)
                throw new UsageError(
                    '--with-token reads the key from stdin. Pipe it: chatbase auth login --with-token < key.txt'
                )
            const key = await readStdinToEnd()
            if (!key) throw new UsageError('No token received on stdin.')
            return this.verifyAndStore(flags, key)
        }

        if (flags.browser) {
            return this.browserLogin(flags)
        }

        if (process.stdin.isTTY && !flags['no-input']) {
            const { select } = await import('@inquirer/prompts')
            const method = await select({
                message: 'How do you want to authenticate?',
                choices: [
                    {
                        value: 'browser',
                        name: 'Log in with browser (recommended)'
                    },
                    { value: 'paste', name: 'Paste an API key' }
                ]
            })
            if (method === 'browser') {
                return this.browserLogin(flags)
            }
            const { password } = await import('@inquirer/prompts')
            const key = (await password({ message: 'Key:', mask: '●' })).trim()
            if (!key) throw new UsageError('No key entered.')
            return this.verifyAndStore(flags, key)
        }

        throw new UsageError(
            'Cannot prompt (no TTY or --no-input). Use: chatbase auth login --with-token < key.txt'
        )
    }

    private async browserLogin(flags: Record<string, unknown>): Promise<void> {
        const pairing = await startPairing()

        this.note(
            flags,
            `\nYour code: ${this.palette(flags).green(pairing.userCode)}\n`
        )
        this.note(
            flags,
            `Open ${pairing.verificationUriComplete} and approve the request.`
        )

        if (process.stdout.isTTY && !flags['no-input']) {
            tryOpenBrowser(pairing.verificationUriComplete)
            this.note(flags, 'Waiting for approval...')
        }

        const result = await pollExchange(pairing.deviceCode, {
            intervalMs: pairing.interval * 1000,
            timeoutMs: pairing.expiresIn * 1000,
            onPoll: () => {
                if (!flags.quiet) {
                    process.stderr.write('.')
                }
            }
        })

        if (!flags.quiet) process.stderr.write('\n')

        writeUserConfig({
            ...readUserConfig(),
            apiKey: result.apiKey
        })
        this.success(flags, `Logged in to workspace ${result.workspace.name}`)
        this.note(flags, `Saved to ${configFile()}`)
    }

    private async verifyAndStore(
        flags: Record<string, unknown>,
        key: string
    ): Promise<void> {
        const client = createApiClient({ apiKey: key })
        const { data, error, response } = await client.GET('/me')
        if (response.ok) {
            const me = data as { workspace?: { name?: string } }
            writeUserConfig({ ...readUserConfig(), apiKey: key })
            this.success(
                flags,
                `Logged in${me?.workspace?.name ? ` to workspace ${me.workspace.name}` : ''}`
            )
        } else if (response.status === 404) {
            writeUserConfig({ ...readUserConfig(), apiKey: key })
            this.note(
                flags,
                'Key stored (verification unavailable — it will be checked on first use).'
            )
        } else {
            throwIfError(response, error)
        }
        this.note(flags, `Saved to ${configFile()}`)
    }
}
