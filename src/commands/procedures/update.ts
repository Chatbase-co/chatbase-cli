import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readSteps, stepFlags } from '../../base/procedures.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type UpdateProcedureBody = components['schemas']['UpdateProcedureBody']

export default class ProceduresUpdate extends AgentCommand {
    static override description =
        "Update a procedure's name, trigger, steps, or status. Omitted properties keep their value; steps replace all steps. Changes go live at once."
    static override examples = [
        '<%= config.bin %> procedures update 0b8f3c1e-... --status enabled -a agt_123',
        '<%= config.bin %> procedures update 0b8f3c1e-... --name "Refund request" --trigger "The customer wants their money back" -a agt_123',
        '<%= config.bin %> procedures update 0b8f3c1e-... --steps @steps.json -a agt_123'
    ]
    static override args = {
        procedureId: Args.string({
            required: true,
            description: 'Procedure ID'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        ...stepFlags,
        name: Flags.string({
            description:
                'New name, 1-100 chars, no line breaks, unique per agent (case-insensitive)'
        }),
        trigger: Flags.string({
            description:
                'When the agent should start the procedure (max 500 chars)'
        }),
        status: Flags.string({
            description:
                'enabled or disabled (enabling needs every mentioned action to exist and be enabled)',
            options: ['enabled', 'disabled']
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ProceduresUpdate)
        const steps = await readSteps(flags)
        const body: UpdateProcedureBody = {
            ...(flags.name !== undefined && { name: flags.name }),
            ...(flags.trigger !== undefined && { trigger: flags.trigger }),
            ...(flags.status && {
                status: flags.status as UpdateProcedureBody['status']
            }),
            ...(steps && { steps: steps as UpdateProcedureBody['steps'] })
        }
        if (Object.keys(body).length === 0) {
            throw new UsageError(
                'Nothing to update. Pass at least one of --name, --trigger, --status, --step, or --steps.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { error, response } = await client.PATCH(
            '/agents/{agentId}/procedures/{procedureId}',
            {
                params: { path: { agentId, procedureId: args.procedureId } },
                body
            }
        )
        throwIfError(response, error)
        this.success(flags, `Updated procedure ${args.procedureId}`)
    }
}
