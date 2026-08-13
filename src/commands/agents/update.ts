import { Args, Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsUpdate extends BaseCommand {
    static override description = 'Update an existing agent'
    static override examples = [
        '<%= config.bin %> agents update agt_123 --name "New Name"',
        '<%= config.bin %> agents update agt_123 --data @agent.json'
    ]
    static override args = {
        agentId: Args.string({ required: true, description: 'Agent ID' })
    }
    static override flags = {
        ...BaseCommand.baseFlags,
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
        const body = {
            ...(await readBodyData(flags.data, flags.field)),
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags.instructions ? { instructions: flags.instructions } : {}),
            ...(flags.model ? { model: flags.model } : {})
        }
        const client = this.apiClient(flags)
        const { error, response } = await client.PUT('/agents/{agentId}', {
            params: { path: { agentId: args.agentId } },
            body: body as never
        })
        throwIfError(response, error)
        this.success(flags, `Updated agent ${args.agentId}`)
    }
}
