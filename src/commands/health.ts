import { throwIfError } from '../client/client.js'
import { BaseCommand } from '../base/base-command.js'

export default class Health extends BaseCommand {
    static override description = 'Check that the Chatbase API is reachable'
    static override examples = ['<%= config.bin %> health', '<%= config.bin %> health --json']
    static override flags = { ...BaseCommand.baseFlags }

    protected override requireAuth = false

    async run(): Promise<void> {
        const { flags } = await this.parse(Health)
        const client = this.apiClient(flags)
        const { data, error, response } = await client.GET('/health')
        throwIfError(response, error)
        if (this.mode(flags) === 'json') {
            process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
            return
        }
        this.success(flags, `API is up (status: ${data?.status})`)
    }
}
