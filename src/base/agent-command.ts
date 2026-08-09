import { Flags } from '@oclif/core'
import { resolveAgent } from '../config/resolve.js'
import { UsageError } from '../errors/errors.js'
import { BaseCommand } from './base-command.js'

export abstract class AgentCommand extends BaseCommand {
    static override baseFlags = {
        ...BaseCommand.baseFlags,
        agent: Flags.string({
            char: 'a',
            description: 'Agent ID (or set CHATBASE_AGENT_ID / chatbase.json)'
        })
    }

    protected agentId(flags: { agent?: string }): string {
        const resolved = resolveAgent(flags.agent)
        if (!resolved) {
            throw new UsageError(
                'No agent specified. Pass -a <agentId>, set CHATBASE_AGENT_ID, or add "agent" to chatbase.json.'
            )
        }
        return resolved.value
    }
}
