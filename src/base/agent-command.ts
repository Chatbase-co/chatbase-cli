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
     * Resolves the effective agent id.
     *
     * Only the -a/--agent FLAG value is allowed to be a display name: it's
     * the one surface a human actually types, so it's worth one GET /agents
     * round trip (via resolveAgentRef) to let names resolve. Values coming
     * from CHATBASE_AGENT_ID, chatbase.json, or the user config are used
     * AS-IS, with no lookup — those are durable, script/CI-facing surfaces,
     * and letting a name resolve there would mean a later workspace rename
     * could silently retarget a saved script to a different agent. We call
     * resolveAgentRef for every flag value, even ones that are already
     * ids — there's no reliable way to tell "looks like an id" from "is an
     * id" without asking the API, and one extra request is a fine trade for
     * interactive use. Env/config paths skip the call entirely, so
     * non-interactive scripts and CI pay nothing extra.
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
