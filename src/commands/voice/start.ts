import { Flags } from '@oclif/core'
import { AgentCommand } from '../../base/agent-command.js'
import { throwIfError } from '../../client/client.js'
import type { components } from '../../generated/api.js'
import type { Column } from '../../output/render.js'

type VoiceSessionRequest = components['schemas']['VoiceSessionRequest']
type VoiceSessionResponse = components['schemas']['VoiceSessionResponse']

const VOICE_SESSION_COLUMNS: Column[] = [
    { key: 'sessionId', header: 'SESSION' },
    { key: 'conversationId', header: 'CONVERSATION' },
    { key: 'userId', header: 'USER' },
    { key: 'roomName', header: 'ROOM' },
    { key: 'maxDurationSeconds', header: 'MAX_SECONDS' },
    { key: 'participantToken', header: 'TOKEN' }
]

export default class VoiceStart extends AgentCommand {
    static override summary = 'Start a voice session'
    static override description =
        'Create a real-time voice session for an agent and print its ' +
        'credentials. Pass the response to the Chatbase Voice SDK ' +
        '(@chatbase-co/voice-sdk) in your client: the SDK connects, publishes ' +
        'the microphone, and the agent joins automatically. Requires a plan ' +
        'with voice mode enabled; voice minutes consume message credits. The ' +
        'participant token is abbreviated in the default output — use --json ' +
        'or --plain for the full value.'
    static override examples = [
        '<%= config.bin %> voice start -a agt_123',
        '<%= config.bin %> voice start --user user_42 --timezone Europe/Paris -a agt_123',
        '<%= config.bin %> voice start --conversation 0b6a1f2e-7c3d-4a5b-8e9f-1a2b3c4d5e6f --json -a agt_123'
    ]
    static override flags = {
        ...AgentCommand.baseFlags,
        conversation: Flags.string({
            description:
                'Conversation ID to reuse, grouping several sessions into one conversation (default: start a new conversation)'
        }),
        user: Flags.string({
            description:
                'Your end-user ID; send a stable value so per-user voice limits apply (default: generated per session)'
        }),
        timezone: Flags.string({
            description:
                'IANA timezone of the end user, used by the agent for time-aware answers',
            default: 'UTC'
        })
    }

    async run(): Promise<void> {
        const { flags } = await this.parse(VoiceStart)
        const client = this.apiClient(flags)
        const agentId = await this.agentId(flags, client)
        // `timezone` carries a spec default, so it is required in the body type.
        const body: VoiceSessionRequest = {
            timezone: flags.timezone,
            ...(flags.conversation
                ? { conversationId: flags.conversation }
                : {}),
            ...(flags.user ? { userId: flags.user } : {})
        }
        const { data, error, response } = await client.POST(
            '/agents/{agentId}/voice/sessions',
            { params: { path: { agentId } }, body }
        )
        throwIfError(response, error)
        const session = (data as { data: VoiceSessionResponse }).data
        const row = {
            sessionId: session.sessionId,
            conversationId: session.conversationId,
            userId: session.userId,
            roomName: session.roomName,
            maxDurationSeconds: String(session.maxDurationSeconds),
            participantToken: session.participantToken
        }
        this.success(flags, 'Voice session started')
        this.printDetail(flags, data, row, VOICE_SESSION_COLUMNS, [
            ['Session', session.sessionId],
            ['Conversation', session.conversationId],
            ['User', session.userId],
            ['Room', session.roomName],
            ['Max duration', `${session.maxDurationSeconds}s`],
            [
                'Token',
                `${session.participantToken.slice(0, 16)}… (${session.participantToken.length} chars)`
            ]
        ])
        if (this.mode(flags) === 'pretty') {
            this.note(
                flags,
                '→ rerun with --json to get the full participant token for the Voice SDK'
            )
        }
    }
}
