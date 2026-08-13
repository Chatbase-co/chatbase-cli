import type { Client } from 'openapi-fetch'
import { fetchAllPages } from '../client/paginate.js'
import { UsageError } from '../errors/errors.js'
import type { paths } from '../generated/api.js'

export type AgentRefResolution = {
    id: string
    /** True when `ref` matched by display name rather than by id. */
    resolvedFromName: boolean
}

type AgentSummary = { id: string; name: string }

/** Resolve an --agent-name value to an ID. Fetches all pages to detect ambiguity. */
export async function resolveAgentRef(
    client: Client<paths>,
    ref: string
): Promise<AgentRefResolution> {
    const { items: agents } = await fetchAllPages<AgentSummary>(
        (query) => client.GET('/agents', { params: { query } }),
        { all: true }
    )

    const byId = agents.find((a) => a.id === ref)
    if (byId) return { id: byId.id, resolvedFromName: false }

    const byName = agents.filter((a) => a.name === ref)
    if (byName.length === 1) return { id: byName[0].id, resolvedFromName: true }
    if (byName.length > 1) {
        const candidates = byName.map((a) => `  ${a.name} (${a.id})`).join('\n')
        throw new UsageError(
            `Multiple agents are named "${ref}":\n${candidates}\nUse the agent ID instead of the name.`
        )
    }
    throw new UsageError(
        `No agent found with ID or name "${ref}". Run \`chatbase agents list\` to see available agents.`
    )
}
