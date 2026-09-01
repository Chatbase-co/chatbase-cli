import { Args } from '@oclif/core'
import type { BaseFlags } from '../../base/base-command.js'
import { BaseCommand } from '../../base/base-command.js'
import { createApiClient } from '../../client/client.js'
import { fetchPages } from '../../client/paginate.js'
import { resolveApiKey } from '../../config/resolve.js'
import { readUserConfig, writeUserConfig } from '../../config/store.js'
import { UsageError } from '../../errors/errors.js'

/** Property names people reach for when about to store a credential —
 * config set never accepts these, no matter the casing. */
const SECRET_KEYS = new Set(['apikey', 'api_key'])

export default class ConfigSet extends BaseCommand {
    static override description = 'Set a CLI configuration value'
    static override examples = [
        '<%= config.bin %> config set agent agt_123',
        '<%= config.bin %> config set agent',
        '<%= config.bin %> config set timeout 60000'
    ]
    static override args = {
        key: Args.string({
            required: true,
            description: 'agent | timeout'
        }),
        value: Args.string({
            required: false,
            description: 'New value (omit for agent to pick interactively)'
        })
    }
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ConfigSet)
        const key = args.key.toLowerCase()

        if (SECRET_KEYS.has(key)) {
            throw new UsageError(
                'Credentials are never stored via `config set` — run `chatbase auth login` instead.'
            )
        }

        if (key === 'agent') {
            if (args.value === '') {
                // Empty value clears — remove the key entirely instead of
                // storing "" and printing the awkward "set to " message.
                const { agent: _cleared, ...rest } = readUserConfig()
                writeUserConfig(rest)
                this.success(flags, 'agent cleared')
                return
            }
            const agentId = args.value ?? (await this.pickAgent(flags))
            writeUserConfig({ ...readUserConfig(), agent: agentId })
            process.stdout.write(`${agentId}\n`)
            this.success(flags, `agent set to ${agentId}`)
            this.warnIfShadowed(flags)
            return
        }

        if (key === 'timeout') {
            if (!args.value) {
                throw new UsageError(
                    'Usage: chatbase config set timeout <milliseconds>'
                )
            }
            const timeoutMs = Number(args.value)
            if (!/^\d+$/.test(args.value) || timeoutMs < 1) {
                throw new UsageError(
                    'timeout must be a positive integer number of milliseconds (>= 1).'
                )
            }
            writeUserConfig({
                ...readUserConfig(),
                timeoutMs
            })
            process.stdout.write(`${args.value}\n`)
            this.success(flags, `timeout set to ${args.value}ms`)
            return
        }

        throw new UsageError(
            `Unknown config key "${args.key}". Valid keys: agent, timeout.`
        )
    }

    private warnIfShadowed(flags: BaseFlags): void {
        const yellow = this.palette(flags).yellow
        const env = process.env.CHATBASE_AGENT_ID
        if (env && env.length > 0) {
            this.note(
                flags,
                yellow(
                    `! CHATBASE_AGENT_ID=${env} is set and takes precedence — unset it for this value to apply.`
                )
            )
        }
    }

    /** No value given for `config set agent`: prompt with a picker over
     * GET /agents, but only when there's a TTY to prompt on. */
    private async pickAgent(flags: BaseFlags): Promise<string> {
        if (!process.stdin.isTTY || flags['no-input']) {
            throw new UsageError(
                'config set agent requires a value in scripts and CI. Usage: chatbase config set agent <agentId>'
            )
        }
        const resolved = resolveApiKey()
        if (!resolved) {
            throw new UsageError(
                'Not authenticated. Run `chatbase auth login`, or set CHATBASE_API_KEY.'
            )
        }
        // Paginate through every page (fetchPages, same helper
        // resolveAgentRef in agent-ref.ts uses) so the picker offers every
        // agent in the workspace, not just whatever fits on the first page.
        const client = createApiClient({ apiKey: resolved.value })
        const { items: agents } = await fetchPages<{
            id: string
            name?: string
        }>((query) => client.GET('/agents', { params: { query } }), {
            all: true
        })
        if (agents.length === 0) {
            throw new UsageError(
                'No agents found in this workspace — create one first with `chatbase agents create`.'
            )
        }
        const { select } = await import('@inquirer/prompts')
        return select({
            message: 'Select an agent:',
            choices: agents.map((a) => ({
                name: `${a.name ?? a.id} (${a.id})`,
                value: a.id
            }))
        })
    }
}
