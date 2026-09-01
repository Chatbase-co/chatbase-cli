import fs from 'node:fs'
import { UsageError } from '../errors/errors.js'

/** Throws a UsageError (no network) unless filePath exists, is a regular file, and is readable. */
export function assertFileReadable(filePath: string): void {
    let stat: fs.Stats
    try {
        stat = fs.statSync(filePath)
    } catch {
        throw new UsageError(`File not found: ${filePath}`)
    }
    if (!stat.isFile()) {
        throw new UsageError(`Not a regular file: ${filePath}`)
    }
    try {
        fs.accessSync(filePath, fs.constants.R_OK)
    } catch {
        throw new UsageError(`File is not readable: ${filePath}`)
    }
}
