import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { findProjectConfig } from '../../src/config/project.js'
import { UsageError } from '../../src/errors/errors.js'

function tempProject(json: unknown, nest = 'a/b') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-proj-'))
    fs.writeFileSync(path.join(root, 'chatbase.json'), JSON.stringify(json))
    const deep = path.join(root, nest)
    fs.mkdirSync(deep, { recursive: true })
    return { root, deep }
}

describe('findProjectConfig', () => {
    it('walks up from nested directories', () => {
        const { root, deep } = tempProject({ agent: 'agt_proj' })
        const found = findProjectConfig(deep)
        expect(found?.agent).toBe('agt_proj')
        expect(found?.path).toBe(path.join(root, 'chatbase.json'))
    })

    it('returns undefined when there is no chatbase.json', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-none-'))
        expect(findProjectConfig(dir)).toBeUndefined()
    })

    it('refuses to run when the project file contains secret-like keys', () => {
        const { deep } = tempProject({ agent: 'x', apiKey: 'sk-oops' })
        expect(() => findProjectConfig(deep)).toThrow(UsageError)
        expect(() => findProjectConfig(deep)).toThrow(/never store secrets/i)
    })

    it('throws a UsageError when chatbase.json is malformed JSON', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cb-badjson-'))
        fs.writeFileSync(path.join(root, 'chatbase.json'), '{ not valid json')
        expect(() => findProjectConfig(root)).toThrow(UsageError)
        expect(() => findProjectConfig(root)).toThrow(/not valid JSON/)
    })
})
