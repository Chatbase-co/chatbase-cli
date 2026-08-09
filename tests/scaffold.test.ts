import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

describe('scaffold', () => {
    it('runs --version and prints the package version', () => {
        const out = execFileSync('node', ['bin/run.js', '--version'], {
            encoding: 'utf8'
        })
        expect(out).toContain('chatbase/0.1.0')
    })

    it('bare invocation shows help and does NOT default into a subcommand', () => {
        const out = execFileSync('node', ['bin/run.js'], { encoding: 'utf8' })
        expect(out).toMatch(/USAGE|COMMANDS|TOPICS/)
    })
})
