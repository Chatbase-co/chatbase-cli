import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { bodyFieldFlags } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type UpdateAgentStylesBody = components['schemas']['UpdateAgentStylesBody']

export default class AgentsStyles extends AgentCommand {
    static override description = 'Update visual styles for an agent'
    static override examples = [
        '<%= config.bin %> agents styles agt_123 --data \'{"chat":{"theme":"dark"}}\'',
        '<%= config.bin %> agents styles --data @styles.json'
    ]
    static override args = {
        agentId: Args.string({
            required: false,
            description: 'Agent ID'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        ...bodyFieldFlags,
        data: Flags.string({
            required: true,
            description:
                'JSON body (@file, @-, or inline). See API docs for style properties'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsStyles)
        if (args.agentId && (flags.agent || flags['agent-name'])) {
            throw new UsageError(
                'Pass the agent ID either positionally or via -a/--agent-name, not both.'
            )
        }
        const stylesData = await readBodyData(flags.data, flags.field)
        const client = this.apiClient(flags)
        const agentId = args.agentId ?? (await this.agentId(flags, client))
        const { error, response } = await client.PUT(
            '/agents/{agentId}/styles',
            {
                params: { path: { agentId } },
                body: {
                    styles: stylesData
                } as UpdateAgentStylesBody
            }
        )
        throwIfError(response, error)
        this.success(flags, `Updated styles for ${agentId}`)
    }
}
