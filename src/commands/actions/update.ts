import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { bodyFieldFlags } from '../../base/base-command.js'
import { readBodyData, readTextInput } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { components } from '../../generated/api.js'

type UpdateActionBody = components['schemas']['UpdateActionBody']

export default class ActionsUpdate extends AgentCommand {
    static override description =
        "Update an action's name, status, when-to-use, procedure-only flag, channel switches, or input fields. Changes go live at once."
    static override examples = [
        '<%= config.bin %> actions update 0b8f3c1e-... --status enabled -a agt_123',
        '<%= config.bin %> actions update 0b8f3c1e-... --name check_order --when-to-use "Use when the customer asks where their order is." -a agt_123',
        '<%= config.bin %> actions update 0b8f3c1e-... --channel whatsapp=off --channel slack=on -a agt_123',
        '<%= config.bin %> actions update 0b8f3c1e-... --data @fields.json -a agt_123'
    ]
    static override args = {
        actionId: Args.string({ required: true, description: 'Action ID' })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        ...bodyFieldFlags,
        name: Flags.string({
            description:
                'New name: 3-64 letters, digits, _ or -, unique per agent; procedures mentioning the old name are updated'
        }),
        status: Flags.string({
            description:
                'enabled or disabled (a draft cannot be disabled; enabling needs completed setup)',
            options: ['enabled', 'disabled']
        }),
        'when-to-use': Flags.string({
            description:
                'When the agent should call the action (max 3000 chars; @file or @- ok). Pass "" to clear; required on enabled actions that are not procedure-only'
        }),
        'procedure-only': Flags.boolean({
            description: 'Only procedures can call the action',
            allowNo: true
        }),
        channel: Flags.string({
            description:
                'Switch a channel on or off as <channel>=on|off (repeatable); unlisted channels keep their setting',
            multiple: true
        }),
        data: Flags.string({
            description:
                'JSON body (@file, @-, or inline). Use it for `fields`: it REPLACES the whole input-field list, so send every field to keep (the `actions get --json` fields round-trip)'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(ActionsUpdate)
        const body: Record<string, unknown> = {
            ...(await readBodyData(flags.data, flags.field))
        }
        if (flags.name !== undefined) body.name = flags.name
        if (flags.status) body.status = flags.status
        if (flags['when-to-use'] !== undefined)
            body.whenToUse = await readTextInput(
                flags['when-to-use'],
                '--when-to-use'
            )
        if (flags['procedure-only'] !== undefined)
            body.procedureOnly = flags['procedure-only']
        if (flags.channel?.length) {
            body.channels = flags.channel.map((c) => {
                const m = /^([a-z_]+)=(on|off)$/.exec(c)
                if (!m)
                    throw new UsageError(
                        `--channel expects <channel>=on|off, got "${c}"`
                    )
                return { channel: m[1], enabled: m[2] === 'on' }
            })
        }
        if (Object.keys(body).length === 0) {
            throw new UsageError(
                'Nothing to update. Pass at least one of --name, --status, --when-to-use, --procedure-only, --channel, or --data.'
            )
        }
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.PATCH(
            '/agents/{agentId}/actions/{actionId}',
            {
                params: { path: { agentId, actionId: args.actionId } },
                body: body as UpdateActionBody
            }
        )
        throwIfError(response, error)
        this.success(flags, `Updated action ${args.actionId}`)
        for (const w of data?.warnings ?? []) {
            this.note(flags, `warning: ${w}`)
        }
    }
}
