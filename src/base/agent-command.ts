import { Flags } from '@oclif/core'
import type { Client } from 'openapi-fetch'
import { resolveAgent } from '../config/resolve.js'
import { UsageError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'
import { resolveAgentRef } from './agent-ref.js'
import { BaseCommand, type BaseFlags } from './base-command.js'

export abstract class AgentCommand extends BaseCommand {
    static override baseFlags = {
        ...BaseCommand.baseFlags,
        agent: Flags.string({
            char: 'a',
            description:
                'Agent ID or name (or set CHATBASE_AGENT_ID / chatbase.json)'
        })
    }

    /**
     * Only the -a flag resolves names (one GET /agents call). Env vars and
     * config values are used as-is — a workspace rename must never silently
     * retarget a saved script.
     */
    protected async agentId(
        flags: BaseFlags & { agent?: string },
        client: Client<paths>
    ): Promise<string> {
        const resolved = resolveAgent(flags.agent)
        if (!resolved) {
            throw new UsageError(
                'No agent specified. Pass -a <agentId>, set CHATBASE_AGENT_ID, or add "agent" to chatbase.json.'
            )
        }
        if (resolved.source !== 'flag') return resolved.value
        const ref = await resolveAgentRef(client, resolved.value)
        if (ref.resolvedFromName) this.note(flags, `→ ${ref.id}`)
        return ref.id
    }
}
