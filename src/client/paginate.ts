import { throwIfError } from './client.js'

/** The one pagination envelope shape every list/paginated endpoint returns.
 * Extracted here so no call site can drift to `cursor?: string` or
 * `cursor: string | null | undefined` on its own — a contract change now
 * only has one type to update. */
export type PaginatedResponse<T> = {
    data: T[]
    pagination: { cursor: string | null; hasMore: boolean; total?: number }
}

/** What `fetchPages` asks its caller for on each page. */
export type PageQuery = { cursor?: string; limit?: number }

/** What every generated `client.GET(...)` call resolves to — the exact
 * shape openapi-fetch returns, so a fetcher is just `(query) =>
 * client.GET(path, { params: { path: ..., query } })`. openapi-fetch's
 * result is a `{data, response}` / `{error, response}` discriminated
 * union, so `data`/`error` are individually optional here to match it. */
export type PageFetcher = (
    query: PageQuery
) => Promise<{ data?: unknown; error?: unknown; response: Response }>

export type FetchPagesOptions = {
    /** Maximum items per page; forwarded to the fetcher untouched. */
    limit?: number
    /** Cursor to resume from, e.g. a `--cursor` flag value. */
    cursor?: string
    /** When true, keeps following `pagination.cursor` until `hasMore` is
     * false. When false/omitted, fetches exactly one page — the `--all`
     * flag's off position in every list command. Callers with no `--all`
     * flag at all (resolveAgentRef, listAllSources, pickAgent) always want
     * every page, so they pass `all: true` unconditionally. */
    all?: boolean
}

/** Pause between pages on `--all` so a long crawl is less likely to share
 * a contested API key's rate-limit window with other traffic. Solo use is
 * well under the v2 limit (1000/10s); this is a courtesy, not a hard pace. */
const PAGE_DELAY_MS = 200

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Fetches one page — or, with `opts.all`, every page — of a cursor-paginated
 * endpoint, following `pagination.cursor` until `hasMore` is false.
 *
 * Returns both the raw `pages` (list commands need these verbatim for
 * `--json`, where `--all` must merge `data` across pages but keep the API's
 * envelope shape for the single-page case) and the flattened `items`
 * (display rows, and callers like resolveAgentRef/listAllSources that only
 * need "every item").
 *
 * The caller supplies a `fetcher` that wraps `client.GET(path, { params })`
 * for its specific endpoint and path params — this helper never sees path
 * templates or param shapes, only the `{cursor, limit}` query it asks for
 * and the `{data, error, response}` result every generated GET returns.
 */
export async function fetchPages<T>(
    fetcher: PageFetcher,
    opts: FetchPagesOptions = {}
): Promise<{ pages: PaginatedResponse<T>[]; items: T[] }> {
    const pages: PaginatedResponse<T>[] = []
    let cursor = opts.cursor
    do {
        if (pages.length > 0) await sleep(PAGE_DELAY_MS)
        const { data, error, response } = await fetcher({
            cursor,
            limit: opts.limit
        })
        throwIfError(response, error)
        const page = data as unknown as PaginatedResponse<T>
        pages.push(page)
        cursor = page.pagination.cursor ?? undefined
    } while (opts.all && pages.at(-1)!.pagination.hasMore && cursor)
    return { pages, items: pages.flatMap((p) => p.data) }
}
