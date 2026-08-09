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
