import { describe, expect, it } from 'vitest'
import {
    ApiError,
    formatApiError,
    parseErrorResponse
} from '../../src/errors/errors.js'

const noColor = { red: (s: string) => s, dim: (s: string) => s }

describe('parseErrorResponse', () => {
    it('parses the API v2 error envelope', () => {
        const err = parseErrorResponse(
            401,
            {
                error: {
                    code: 'AUTH_MISSING_API_KEY',
                    message: 'Authentication required'
                }
            },
            'req_123'
        )
        expect(err).toBeInstanceOf(ApiError)
        expect(err.code).toBe('AUTH_MISSING_API_KEY')
        expect(err.status).toBe(401)
        expect(err.requestId).toBe('req_123')
        expect(err.remediation).toContain('chatbase auth login')
    })

    it('scoped-key permission denial guides to scopes, never to a plan upsell', () => {
        const err = parseErrorResponse(403, {
            error: {
                code: 'PERMISSION_DENIED',
                message: 'Missing permission: sources:write'
            }
        })
        expect(err.remediation).toContain('auth status')
        expect(err.remediation).not.toContain('plan')
    })

    it('expired keys point at re-login, distinct from invalid keys', () => {
        const err = parseErrorResponse(401, {
            error: { code: 'API_KEY_EXPIRED', message: 'API key expired' }
        })
        expect(err.remediation).toContain('chatbase auth login')
        expect(err.remediation).toContain('expired')
    })

    it('keeps field-level details for validation errors', () => {
        const err = parseErrorResponse(400, {
            error: {
                code: 'VALIDATION_INVALID_BODY',
                message: 'Invalid request',
                details: { name: 'required' }
            }
        })
        expect(err.details).toEqual({ name: 'required' })
    })

    it('falls back to status-based codes for non-envelope bodies', () => {
        const err = parseErrorResponse(502, 'Bad Gateway')
        expect(err.code).toBe('HTTP_502')
        expect(err.message).toContain('502')
    })
})

describe('formatApiError', () => {
    it('puts remediation last and includes the request id', () => {
        const err = parseErrorResponse(
            401,
            {
                error: {
                    code: 'AUTH_INVALID_API_KEY',
                    message: 'Invalid API key'
                }
            },
            'req_9'
        )
        const out = formatApiError(err, noColor)
        expect(out).toContain('✗ Invalid API key (AUTH_INVALID_API_KEY)')
        expect(out).toContain('request id: req_9')
        expect(out.trim().split('\n').at(-1)).toMatch(
            /auth login|CHATBASE_API_KEY/
        )
    })

    it('lists validation details one field per line', () => {
        const err = parseErrorResponse(400, {
            error: {
                code: 'VALIDATION_INVALID_BODY',
                message: 'Invalid request',
                details: { name: 'required', url: 'must be a valid URL' }
            }
        })
        const out = formatApiError(err, noColor)
        expect(out).toContain('name  required')
        expect(out).toContain('url  must be a valid URL')
    })
})
