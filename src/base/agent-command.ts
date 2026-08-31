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
            description: 'Agent ID (or set CHATBASE_AGENT_ID)'
        }),
        'agent-name': Flags.string({
            description:
                'Agent display name — resolves to an ID via GET /agents',
            exclusive: ['agent']
        })
    }

    /**
     * -a is always an ID (no API call). --agent-name resolves via the
     * agents list. The two flags are mutually exclusive.
     */
    protected async agentId(
        flags: BaseFlags & { agent?: string; 'agent-name'?: string },
        client: Client<paths>
    ): Promise<string> {
        if (flags['agent-name']) {
            const id = await resolveAgentRef(client, flags['agent-name'])
            this.note(flags, `→ ${id}`)
            return id
        }
        const resolved = resolveAgent(flags.agent)
        if (!resolved) {
            throw new UsageError(
                'No agent specified. Pass -a <agentId>, --agent-name <name>, or set CHATBASE_AGENT_ID.'
            )
        }
        return resolved.value
    }
}
