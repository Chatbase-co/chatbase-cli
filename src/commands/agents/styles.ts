import { Args, Flags } from '@oclif/core'
import { BaseCommand, bodyFieldFlags } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'

type UpdateAgentStylesBody = components['schemas']['UpdateAgentStylesBody']

export default class AgentsStyles extends BaseCommand {
    static override description = 'Update visual styles for an agent'
    static override examples = [
        '<%= config.bin %> agents styles agt_123 --data \'{"chat":{"theme":"dark"}}\'',
        '<%= config.bin %> agents styles agt_123 --data @styles.json'
    ]
    static override args = {
        agentId: Args.string({
            required: true,
            description: 'Agent ID'
        })
    }
    static override flags = {
        ...BaseCommand.baseFlags,
        ...bodyFieldFlags,
        data: Flags.string({
            required: true,
            description:
                'JSON body (@file, @-, or inline). See API docs for style properties'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(AgentsStyles)
        const stylesData = await readBodyData(flags.data, flags.field)
        const client = this.apiClient(flags)
        const { error, response } = await client.PUT(
            '/agents/{agentId}/styles',
            {
                params: { path: { agentId: args.agentId } },
                body: {
                    styles: stylesData
                } as UpdateAgentStylesBody
            }
        )
        throwIfError(response, error)
        this.success(flags, `Updated styles for ${args.agentId}`)
    }
}
