import { Flags } from '@oclif/core'
import { AgentCommand } from './agent-command.js'

export abstract class ListCommand extends AgentCommand {
    static override baseFlags = {
        ...AgentCommand.baseFlags,
        limit: Flags.integer({
            description: 'Maximum items per page',
            min: 1,
            max: 100
        }),
        cursor: Flags.string({
            description: 'Pagination cursor from a previous page'
        }),
        all: Flags.boolean({ description: 'Fetch every page' })
    }
}
