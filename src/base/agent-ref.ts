import type { Client } from 'openapi-fetch'
import { fetchAllPages } from '../client/paginate.js'
import { UsageError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'

type AgentSummary = { id: string; name: string }

/** Resolve an --agent-name value to an ID. Fetches all pages to detect ambiguity. */
export async function resolveAgentRef(
    client: Client<paths>,
    name: string
): Promise<string> {
    const { items: agents } = await fetchAllPages<AgentSummary>(
        (query) => client.GET('/agents', { params: { query } }),
        { all: true }
    )

    const matches = agents.filter((a) => a.name === name)
    if (matches.length === 1) return matches[0].id
    if (matches.length > 1) {
        const candidates = matches
            .map((a) => `  ${a.name} (${a.id})`)
            .join('\n')
        throw new UsageError(
            `Multiple agents are named "${name}":\n${candidates}\nUse -a with the agent ID instead.`
        )
    }
    throw new UsageError(
        `No agent named "${name}". Run \`chatbase agents list\` to see available agents.`
    )
}
