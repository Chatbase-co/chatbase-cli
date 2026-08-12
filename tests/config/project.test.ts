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

    it('parses sync.dir/include/exclude when present', () => {
        const { deep } = tempProject({
            agent: 'agt_proj',
            sync: {
                dir: 'kb',
                include: ['**/*.md'],
                exclude: ['**/drafts/**']
            }
        })
        const found = findProjectConfig(deep)
        expect(found?.sync).toEqual({
            dir: 'kb',
            include: ['**/*.md'],
            exclude: ['**/drafts/**']
        })
    })

    it('leaves sync undefined when absent', () => {
        const { deep } = tempProject({ agent: 'agt_proj' })
        expect(findProjectConfig(deep)?.sync).toBeUndefined()
    })

    it('ignores a sync block whose fields are the wrong type, rather than throwing', () => {
        const { deep } = tempProject({
            sync: { dir: 123, include: 'not-an-array', exclude: ['ok', 5] }
        })
        const found = findProjectConfig(deep)
        expect(found?.sync?.dir).toBeUndefined()
        expect(found?.sync?.include).toBeUndefined()
        expect(found?.sync?.exclude).toEqual(['ok'])
    })

    it('leaves sync undefined when the sync key is present but not an object', () => {
        const { deep } = tempProject({ agent: 'agt_proj', sync: 'nope' })
        expect(findProjectConfig(deep)?.sync).toBeUndefined()
    })
})
