export class UsageError extends Error {}

export class ApiError extends Error {
    code: string
    status: number
    requestId?: string
    details?: unknown
    remediation?: string

    constructor(opts: {
        code: string
        message: string
        status: number
        requestId?: string
        details?: unknown
        remediation?: string
    }) {
        super(opts.message)
        this.code = opts.code
        this.status = opts.status
        this.requestId = opts.requestId
        this.details = opts.details
        this.remediation = opts.remediation
    }
}

const REMEDIATIONS: Record<string, string> = {
    AUTH_MISSING_API_KEY:
        'Run `chatbase auth login`, or set CHATBASE_API_KEY. Keys live in chatbase.co → Workspace Settings → API Keys.',
    AUTH_INVALID_API_KEY:
        'Your key was rejected. Run `chatbase auth login` with a fresh key, or check CHATBASE_API_KEY.',
    API_KEY_EXPIRED:
        'This API key has expired. Run `chatbase auth login` to authenticate again.',
    PERMISSION_DENIED:
        'This API key does not have permission for this operation. Check its scopes with `chatbase auth status`, re-pair with broader access via `chatbase auth login`, or ask a workspace admin.',
    VALIDATION_INVALID_BODY: 'Fix the fields above and retry.'
}

const STATUS_REMEDIATIONS: Record<number, string> = {
    403: 'API access requires the Standard plan or higher — upgrade at chatbase.co.',
    404: 'Resource not found — check the ID (agent IDs live in your dashboard).',
    429: 'Rate limited — the CLI already retried; wait for the reset and try again.'
}

type Envelope = { error: { code: string; message: string; details?: unknown } }

function isEnvelope(body: unknown): body is Envelope {
    return (
        typeof body === 'object' &&
        body !== null &&
        typeof (body as Envelope).error === 'object' &&
        typeof (body as Envelope).error?.code === 'string'
    )
}

export function parseErrorResponse(
    status: number,
    body: unknown,
    requestId?: string
): ApiError {
    if (isEnvelope(body)) {
        const { code, message, details } = body.error
        return new ApiError({
            code,
            message,
            status,
            requestId,
            details,
            remediation: REMEDIATIONS[code] ?? STATUS_REMEDIATIONS[status]
        })
    }
    return new ApiError({
        code: `HTTP_${status}`,
        message: `Request failed with status ${status}`,
        status,
        requestId,
        remediation: STATUS_REMEDIATIONS[status]
    })
}

export function formatApiError(
    err: ApiError,
    color: { red(s: string): string; dim(s: string): string }
): string {
    const lines: string[] = [color.red(`✗ ${err.message} (${err.code})`)]
    if (err.details && typeof err.details === 'object') {
        for (const [field, problem] of Object.entries(
            err.details as Record<string, unknown>
        )) {
            lines.push(`    ${field}  ${String(problem)}`)
        }
    }
    if (err.requestId) lines.push(color.dim(`  request id: ${err.requestId}`))
    if (err.remediation) lines.push(`  ${err.remediation}`)
    return lines.join('\n')
}
