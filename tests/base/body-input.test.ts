import { describe, expect, it } from 'vitest'
import { readBodyData, readTextInput } from '../../src/base/body-input.js'
import { UsageError } from '../../src/errors/errors.js'

describe('readBodyData', () => {
    it('returns {} when no data is given', async () => {
        expect(await readBodyData()).toEqual({})
    })

    it('parses inline JSON', async () => {
        expect(await readBodyData('{"a":1}')).toEqual({ a: 1 })
    })

    it('rejects a bare "@" with a UsageError instead of readFileSync\'s raw ENOENT', async () => {
        let error: unknown
        try {
            await readBodyData('@')
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(UsageError)
        expect((error as Error).message).toContain('--data @')
    })
})

describe('readTextInput', () => {
    it('returns the value unchanged when it has no @ prefix', async () => {
        expect(await readTextInput('hello')).toBe('hello')
    })

    it('rejects a bare "@" with a UsageError instead of readFileSync\'s raw ENOENT', async () => {
        let error: unknown
        try {
            await readTextInput('@')
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(UsageError)
        expect((error as Error).message).toContain('--content @')
    })
})
