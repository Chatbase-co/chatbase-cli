import type { Hook } from '@oclif/core'

/**
 * `chat` is both a command and a topic (`chat retry`), so oclif resolves
 * `chatbase chat "hello"` by looking for a subcommand named "hello" and
 * lands in command_not_found. Without this hook, plugin-not-found prints
 * a baffling `"chat hello" is not a chatbase command` — catch that one
 * miss and point at the real input forms instead.
 */
const hook: Hook<'command_not_found'> = async function (opts) {
    // oclif joins the attempted command with its internal ':' separator —
    // `chatbase chat "what are your hours?"` arrives as
    // { id: 'chat:what are your hours?', argv: [] }.
    const argv = (opts as { argv?: string[] }).argv ?? []
    const parts = [...(opts.id ?? '').split(':'), ...argv].filter(Boolean)
    if (parts[0] !== 'chat' || parts.length < 2) return
    const attempted = parts.slice(1).join(' ')
    this.error(
        `chat takes its message via -m, not as an argument:\n` +
            `  chatbase chat -m ${JSON.stringify(attempted)}\n` +
            `You can also pipe stdin, or run \`chatbase chat\` alone for the interactive REPL.`,
        { exit: 2 }
    )
}

export default hook
