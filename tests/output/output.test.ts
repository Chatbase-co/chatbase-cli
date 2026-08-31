import { afterEach, describe, expect, it, vi } from 'vitest'
import { colorEnabled } from '../../src/output/color.js'
import { selectMode } from '../../src/output/mode.js'
import { renderPlain, renderTable } from '../../src/output/render.js'

describe('selectMode', () => {
    it('json flag wins, then plain flag, then TTY detection', () => {
        expect(selectMode({ json: true, plain: true }, { isTTY: true })).toBe(
            'json'
        )
        expect(selectMode({ plain: true }, { isTTY: true })).toBe('plain')
        expect(selectMode({}, { isTTY: true })).toBe('pretty')
        expect(selectMode({}, { isTTY: false })).toBe('plain')
    })
})

describe('colorEnabled', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('FORCE_COLOR overrides everything', () => {
        vi.stubEnv('FORCE_COLOR', '1')
        vi.stubEnv('NO_COLOR', '1')
        expect(colorEnabled({ isTTY: false })).toBe(true)
    })

    it('disabled by --no-color, NO_COLOR, TERM=dumb, non-TTY', () => {
        expect(colorEnabled({ isTTY: true }, true)).toBe(false)
        vi.stubEnv('NO_COLOR', '1')
        expect(colorEnabled({ isTTY: true })).toBe(false)
        vi.unstubAllEnvs()
        vi.stubEnv('TERM', 'dumb')
        expect(colorEnabled({ isTTY: true })).toBe(false)
        vi.unstubAllEnvs()
        expect(colorEnabled({ isTTY: false })).toBe(false)
        expect(colorEnabled({ isTTY: true })).toBe(true)
    })
})

const rows = [
    { id: 'c_1', title: 'Refund question', status: 'open' },
    { id: 'c_22', title: 'Hi', status: 'closed' }
]
const columns = [
    { key: 'id', header: 'ID' },
    { key: 'title', header: 'TITLE' },
    { key: 'status', header: 'STATUS' }
]

describe('renderers', () => {
    it('renderTable aligns columns under headers', () => {
        const out = renderTable(rows, columns)
        const lines = out.split('\n')
        expect(lines[0]).toMatch(/^ID\s+TITLE\s+STATUS$/)
        expect(lines[1].indexOf('Refund')).toBe(lines[0].indexOf('TITLE'))
    })

    it('renderPlain emits one tab-separated record per line, no header', () => {
        const out = renderPlain(rows, columns)
        expect(out.split('\n')).toEqual([
            'c_1\tRefund question\topen',
            'c_22\tHi\tclosed'
        ])
    })
})
