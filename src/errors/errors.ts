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

/**
 * Remediation advice appended to API errors, resolved in two tiers:
 * exact error code first (this map), HTTP status fallback second
 * (STATUS_REMEDIATIONS). The server's own message always prints; these
 * only add "here's what to do about it".
 */
const REMEDIATIONS: Record<string, string> = {
    AUTH_MISSING_API_KEY:
        'Run `chatbase auth login`, or set CHATBASE_API_KEY. Keys live in chatbase.co → Workspace Settings → API Keys.',
    AUTH_INVALID_API_KEY:
        'Your key was rejected. Run `chatbase auth login` with a fresh key, or check CHATBASE_API_KEY.',
    AUTH_EXPIRED_API_KEY:
        'This API key has expired. Run `chatbase auth login` to authenticate again.',
    AUTH_INSUFFICIENT_PERMISSIONS:
        'This API key does not have permission for this operation. Check its scopes with `chatbase auth status`, re-pair with broader access via `chatbase auth login`, or ask a workspace admin.',
    SUBSCRIPTION_API_RESTRICTED_PLAN:
        'API access requires the Standard plan or higher — upgrade at chatbase.co.',
    VALIDATION_INVALID_BODY: 'Fix the fields above and retry.'
}

/**
 * Fallback tier: best-guess advice for error CODES this CLI version doesn't
 * know (e.g. the API added one after this release), keyed by HTTP status.
 * No 403 fallback: the API has many distinct 403 codes (AGENT_LIMIT_REACHED,
 * HELPDESK_NOT_ENABLED, plan gates, ...) whose server messages are already
 * self-explanatory — a blanket guess was actively misleading for most.
 */
const STATUS_REMEDIATIONS: Record<number, string> = {
    404: 'Resource not found — check the ID (agent IDs live in your dashboard).',
    429: 'Rate limited — the CLI already retried; wait for the reset and try again.'
}

type ErrorEnvelope = {
    error: { code: string; message: string; details?: unknown }
}

function isErrorEnvelope(body: unknown): body is ErrorEnvelope {
    return (
        typeof body === 'object' &&
        body !== null &&
        typeof (body as ErrorEnvelope).error === 'object' &&
        typeof (body as ErrorEnvelope).error?.code === 'string'
    )
}

export function parseErrorResponse(
    status: number,
    body: unknown,
    requestId?: string
): ApiError {
    if (isErrorEnvelope(body)) {
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
