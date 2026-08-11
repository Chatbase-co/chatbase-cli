/**
 * Every path the CLI touches on disk, per the XDG Base Directory spec —
 * config (worth backing up), state/logs (history), cache (disposable).
 * These three directories are the CLI's ENTIRE disk footprint; the README's
 * uninstall instructions promise exactly them, so never write anywhere else.
 *
 * Deliberate choices: XDG applies on macOS too (matching `gh`, not
 * ~/Library), and these are functions rather than constants because the
 * env overrides must be read at call time — tests stub XDG_* per test.
 */
import os from 'node:os'
import path from 'node:path'

function xdg(envVar: string, fallback: string): string {
    const v = process.env[envVar]
    return v && v.length > 0 ? v : path.join(os.homedir(), fallback)
}

export const configDir = () =>
    path.join(xdg('XDG_CONFIG_HOME', '.config'), 'chatbase')
export const configFile = () => path.join(configDir(), 'config.json')
export const stateDir = () =>
    path.join(xdg('XDG_STATE_HOME', '.local/state'), 'chatbase')
export const logsDir = () => path.join(stateDir(), 'logs')
export const cacheDir = () =>
    path.join(xdg('XDG_CACHE_HOME', '.cache'), 'chatbase')
