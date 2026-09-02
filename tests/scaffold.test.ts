import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { VERSION } from '../src/version.js'

describe('scaffold', () => {
    it('runs --version and prints the package version', () => {
        const out = execFileSync('node', ['bin/run.js', '--version'], {
            encoding: 'utf8'
        })
        expect(out).toContain(`chatbase/${VERSION}`)
    })

    it('bare invocation shows help and does NOT default into a subcommand', () => {
        const out = execFileSync('node', ['bin/run.js'], { encoding: 'utf8' })
        expect(out).toMatch(/USAGE|COMMANDS|TOPICS/)
    })

    it('command help shows examples and docs link', () => {
        const out = execFileSync(
            'node',
            ['bin/run.js', 'auth', 'login', '--help'],
            { encoding: 'utf8' }
        )
        expect(out).toContain('EXAMPLES')
        expect(out).toContain('auth login')
    })

    it('trailing -h anywhere shows help', () => {
        const out = execFileSync(
            'node',
            ['bin/run.js', 'conversations', 'list', '-h'],
            { encoding: 'utf8' }
        )
        expect(out).toContain('USAGE')
    })
})
