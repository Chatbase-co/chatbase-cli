#!/usr/bin/env node
import { execute } from '@oclif/core'

// Convert -h to --help for consistency with common CLI conventions
const argv = process.argv.map((arg) => (arg === '-h' ? '--help' : arg))
process.argv = argv

await execute({ dir: import.meta.url })
