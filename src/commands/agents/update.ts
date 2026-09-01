import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { bodyFieldFlags } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type UpdateAgentBody = components['schemas']['UpdateAgentBody']

export default class AgentsUpdate extends AgentCommand {
    static override description = 'Update an existing agent'
    static override examples = [
        '<%= config.bin %> agents update agt_123 --name "New Name"',
        '<%= config.bin %> agents update --name "New Name"',
        '<%= config.bin %> agents update agt_123 --data @agent.json'
    ]
    static override args = {
        agentId: Args.string({ required: false, description: 'Agent ID' })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        ...bodyFieldFlags,
        name: Flags.string({ description: 'Agent name' }),
        instructions: Flags.string({ description: 'System instructions' }),
        model: Flags.string({ description: 'Model ID' }),
        data: Flags.string({
            description:
                'JSON body (@file, @-, or inline). Fields: name, instructions, model, visibility, temp'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsUpdate)
        if (args.agentId && (flags.agent || flags['agent-name'])) {
            throw new UsageError(
                'Pass the agent ID either positionally or via -a/--agent-name, not both.'
            )
        }
        const body = {
            ...(await readBodyData(flags.data, flags.field)),
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags.instructions ? { instructions: flags.instructions } : {}),
            ...(flags.model ? { model: flags.model } : {})
        }
        const client = this.apiClient(flags)
        const agentId = args.agentId ?? (await this.agentId(flags, client))
        const { error, response } = await client.PUT('/agents/{agentId}', {
            params: { path: { agentId } },
            body: body as UpdateAgentBody
        })
        throwIfError(response, error)
        this.success(flags, `Updated agent ${agentId}`)
    }
}
