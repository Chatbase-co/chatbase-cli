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

/**
 * Resolves a `-a/--agent` reference that may be either an agent id or an
 * exact display name. Only ever called for the FLAG value — see
 * AgentCommand.agentId() for why env/config values skip this entirely.
 *
 * Fetches every page of GET /agents (via fetchAllPages, same helper `agents
 * list --all` uses) so ambiguous names are always detected even when the
 * workspace has more agents than fit on one page. Ids are matched first and
 * win outright: an id is unambiguous by definition, so there's no reason to
 * also scan for name collisions once one is found.
 */
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
