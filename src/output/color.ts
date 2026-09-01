export type Palette = {
    red(s: string): string
    green(s: string): string
    yellow(s: string): string
    dim(s: string): string
}

export function colorEnabled(
    stream: { isTTY?: boolean },
    noColorFlag = false
): boolean {
    const force = process.env.FORCE_COLOR
    if (force && force.length > 0 && force !== '0') return true
    if (noColorFlag) return false
    const no = process.env.NO_COLOR
    if (no && no.length > 0) return false
    if (process.env.TERM === 'dumb') return false
    return stream.isTTY === true
}

const wrap = (open: string) => (s: string) => `\x1b[${open}m${s}\x1b[0m`
const identity = (s: string) => s

export function paint(enabled: boolean): Palette {
    if (!enabled)
        return {
            red: identity,
            green: identity,
            yellow: identity,
            dim: identity
        }
    return {
        red: wrap('31'),
        green: wrap('32'),
        yellow: wrap('33'),
        dim: wrap('2')
    }
}
