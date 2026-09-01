import { spawn } from 'node:child_process'
import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { readStdinToEnd } from '../../base/body-input.js'
import { rawApiFetch } from '../../client/client.js'
import { pollExchange, startPairing } from '../../client/pairing.js'
import { configFile } from '../../config/paths.js'
import { writeUserConfig } from '../../config/store.js'
import { parseErrorResponse, UsageError } from '../../errors/errors.js'

function tryOpenBrowser(url: string): void {
    try {
        if (process.platform === 'win32') {
            spawn('cmd', ['/c', 'start', '', url], {
                detached: true,
                stdio: 'ignore'
            })
                .on('error', () => {})
                .unref()
            return
        }
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        spawn(cmd, [url], { detached: true, stdio: 'ignore' })
            .on('error', () => {})
            .unref()
    } catch {
        // Synchronous spawn() failure — same best-effort contract.
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
            const key = (await readStdinToEnd()).trim()
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
            `Open ${pairing.verificationUri} and enter the code to approve.`
        )

        if (process.stdout.isTTY && !flags['no-input']) {
            tryOpenBrowser(pairing.verificationUri)
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
            apiKey: result.apiKey,
            apiKeySource: 'pairing'
        })
        this.success(flags, `Logged in to workspace ${result.workspace.name}`)
        this.note(flags, `Saved to ${configFile()}`)
    }

    private async verifyAndStore(
        flags: Record<string, unknown>,
        key: string
    ): Promise<void> {
        const res = await rawApiFetch('GET', '/me', { apiKey: key })
        if (res.status === 200) {
            const body = res.body as {
                workspace?: { name?: string }
            }
            writeUserConfig({ apiKey: key })
            this.success(
                flags,
                `Logged in${body.workspace?.name ? ` to workspace ${body.workspace.name}` : ''}`
            )
        } else if (res.status === 404) {
            writeUserConfig({ apiKey: key })
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
