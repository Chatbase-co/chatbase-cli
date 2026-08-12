import { spawn } from 'node:child_process'
import { BaseCommand } from '../base/base-command.js'

const DOCS_BASE = 'https://www.chatbase.co/docs/cli'

/**
 * Waits for the child process to either report it started, or fail to start
 * (e.g. ENOENT when `open`/`xdg-open` isn't on PATH) — both are async events
 * on the returned ChildProcess, so a plain try/catch around spawn() can't
 * observe them; we need to await one or the other before deciding whether
 * to fall back to printing the URL.
 */
function trySpawn(command: string, args: string[]): Promise<boolean> {
    return new Promise((resolve) => {
        try {
            const child = spawn(command, args, {
                detached: true,
                stdio: 'ignore'
            })
            child.once('error', () => resolve(false))
            child.once('spawn', () => {
                child.unref()
                resolve(true)
            })
        } catch {
            resolve(false)
        }
    })
}

export default class Docs extends BaseCommand {
    static override description =
        'Open the Chatbase CLI documentation, or a specific command page'
    static override examples = [
        '<%= config.bin %> docs',
        '<%= config.bin %> docs sources sync'
    ]
    // Variadic: any number of words naming a command page, e.g. `sources sync`.
    static override strict = false
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags, argv } = await this.parse(Docs)
        const words = argv.map(String)
        const url =
            words.length > 0 ? `${DOCS_BASE}/${words.join('-')}` : DOCS_BASE

        if (!process.stdout.isTTY || flags['no-input']) {
            process.stderr.write(`${url}\n`)
            return
        }

        const opener = process.platform === 'darwin' ? 'open' : 'xdg-open'
        const opened = await trySpawn(opener, [url])
        if (opened) {
            this.note(flags, `Opening ${url}`)
        } else {
            process.stderr.write(`${url}\n`)
        }
    }
}
