import { Args, Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { readTextInput } from '../../base/body-input.js'
import { throwIfError } from '../../client/client.js'
import { UsageError } from '../../errors/errors.js'
import type { paths } from '../../generated/api.js'

type EventBody = NonNullable<
    paths['/agents/{agentId}/missions/events']['post']['requestBody']
>['content']['application/json']
type Subject = NonNullable<EventBody['subject']>

const SUBJECT_FLAGS = ['external-id', 'email', 'phone', 'run-id']

export default class EventsSend extends AgentCommand {
    static override description =
        'Record an event about a person or a mission run. Missions use events to start, wake and end runs'
    static override examples = [
        '<%= config.bin %> events send trial_started --email ada@example.com --properties \'{"plan":"pro"}\' -a agt_123',
        '<%= config.bin %> events send follow_up --run-id 6f1c2d3e-0000-4000-8000-000000000000 --effect wake -a agt_123'
    ]
    static override args = {
        type: Args.string({
            required: true,
            description:
                'Event name (letters, digits, _ . -, up to 100). A `custom.` prefix is optional'
        })
    }
    static override flags = {
        ...AgentCommand.baseFlags,
        'external-id': Flags.string({
            description:
                'Person to record the event about, by your own ID (exactly one of --external-id/--email/--phone/--run-id)',
            exactlyOne: SUBJECT_FLAGS
        }),
        email: Flags.string({
            description:
                'Person by email; the contact is created when new (exactly one subject flag)',
            exactlyOne: SUBJECT_FLAGS
        }),
        phone: Flags.string({
            description:
                'Person by phone number; the contact is created when new (exactly one subject flag)',
            exactlyOne: SUBJECT_FLAGS
        }),
        'run-id': Flags.string({
            description:
                'Mission run (UUID) to act on; requires --effect (exactly one subject flag)',
            exactlyOne: SUBJECT_FLAGS
        }),
        effect: Flags.string({
            description:
                'For --run-id only: wake the run, add to its context, or end it as succeeded',
            options: ['wake', 'context', 'end_run']
        }),
        details: Flags.string({
            description: 'Short note for a run subject (max 500 chars)'
        }),
        properties: Flags.string({
            description:
                'Event fields as a JSON object, at most 8 KB (inline, @file, or @- for stdin)'
        }),
        'idempotency-key': Flags.string({
            description:
                'Sending the same key again does nothing (max 200 chars)'
        })
    }

    async run(): Promise<void> {
        const { args, flags } = await this.parse(EventsSend)
        const isRun = flags['run-id'] !== undefined
        if (isRun && !flags.effect) {
            throw new UsageError(
                '--effect is required with --run-id (wake, context or end_run).'
            )
        }
        if (!isRun && flags.effect) {
            throw new UsageError('--effect is only allowed with --run-id.')
        }
        if (!isRun && flags.details) {
            throw new UsageError('--details is only allowed with --run-id.')
        }

        let properties: Record<string, unknown> = {}
        if (flags.properties) {
            const raw = await readTextInput(flags.properties, '--properties')
            let parsed: unknown
            try {
                parsed = JSON.parse(raw)
            } catch {
                throw new UsageError(
                    '--properties must be a valid JSON object.'
                )
            }
            if (
                typeof parsed !== 'object' ||
                parsed === null ||
                Array.isArray(parsed)
            ) {
                throw new UsageError('--properties must be a JSON object.')
            }
            properties = parsed as Record<string, unknown>
        }

        const subject: Subject = {
            ...(flags['external-id']
                ? { external_id: flags['external-id'] }
                : {}),
            ...(flags.email ? { email: flags.email } : {}),
            ...(flags.phone ? { phone: flags.phone } : {}),
            ...(flags['run-id'] ? { run_id: flags['run-id'] } : {})
        }
        const body: EventBody = {
            type: args.type,
            properties,
            subject,
            ...(flags.effect
                ? { effect: flags.effect as EventBody['effect'] }
                : {}),
            ...(flags.details ? { details: flags.details } : {}),
            ...(flags['idempotency-key']
                ? { idempotency_key: flags['idempotency-key'] }
                : {})
        }

        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/missions/events',
            { params: { path: { agentId } }, body }
        )
        throwIfError(response, error)
        if (this.mode(flags) === 'json') {
            process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)
            return
        }
        this.success(flags, `Event ${args.type} recorded (id ${data?.id})`)
    }
}
