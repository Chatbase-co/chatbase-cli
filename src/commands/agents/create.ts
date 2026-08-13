import { Flags } from '@oclif/core'
import { BaseCommand } from '../../base/base-command.js'
import { readBodyData } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'

export default class AgentsCreate extends BaseCommand {
    static override description = 'Create a new agent'
    static override examples = [
        '<%= config.bin %> agents create --name "Support Bot" --instructions "Be helpful"',
        '<%= config.bin %> agents create --data @agent.json'
    ]
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
        const { flags } = await this.parse(AgentsCreate)
        const body = {
            ...(await readBodyData(flags.data, flags.field)),
            ...(flags.name ? { name: flags.name } : {}),
            ...(flags.instructions ? { instructions: flags.instructions } : {}),
            ...(flags.model ? { model: flags.model } : {})
        }
        const client = this.apiClient(flags)
        const { data, error, response } = await client.POST('/agents', {
            body: body as never
        })
        throwIfError(response, error)
        // Note: POST /agents returns AgentCreatedResponse directly ({ id, pendingSteps? }), not wrapped in { data: ... }
        const id = (data as { id: string }).id
        this.success(flags, `Created agent ${id}`)
        process.stdout.write(`${id}\n`)
    }
}
