import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readSteps, stepFlags } from '../../base/procedures.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type CreateProcedureBody = components['schemas']['CreateProcedureBody']

export default class ProceduresCreate extends AgentCommand {
    static override description =
        'Create a procedure on the live agent. It starts disabled; enable it with `procedures update --status enabled` once every action its steps mention exists and is enabled.'
    static override examples = [
        '<%= config.bin %> procedures create --name "Refund a recent order" --trigger "The customer asks for a refund" --step "Ask for the order number, then call @get_order" -a agt_123',
        '<%= config.bin %> procedures create --name Refund --trigger "Refund request" --steps @steps.json -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        ...stepFlags,
        name: Flags.string({
            required: true,
            description:
                'Name, 1-100 chars, no line breaks, unique per agent (case-insensitive)'
        }),
        trigger: Flags.string({
            required: true,
            description:
                'When the agent should start the procedure (max 500 chars)'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(ProceduresCreate)
        const steps = await readSteps(flags)
        if (!steps) {
            throw new UsageError(
                'Pass the steps with --step (repeatable) or --steps.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const body: CreateProcedureBody = {
            name: flags.name,
            trigger: flags.trigger,
            steps: steps as CreateProcedureBody['steps']
        }
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/procedures',
            { params: { path: { agentId } }, body }
        )
        throwIfError(response, error)
        this.success(
            flags,
            `Created procedure ${data?.id ?? ''} (disabled; enable it with \`procedures update --status enabled\`)`
        )
    }
}
