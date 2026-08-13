import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAgentRef } from '../../src/base/agent-ref.js'
import { createApiClient } from '../../src/client/client.js'
import { UsageError } from '../../src/errors/errors.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

const agent1 = { id: 'agt_1', name: 'Support Bot' }
const agent2 = { id: 'agt_2', name: 'Sales Bot' }
const agent3 = { id: 'agt_3', name: 'Support Bot' } // duplicate name

function client() {
    return createApiClient({ apiKey: 'sk-test' })
}

beforeEach(() => {
    mock = new MockAgent()
    mock.disableNetConnect()
    setGlobalDispatcher(mock)
})

afterEach(async () => {
    await mock.close()
})

describe('resolveAgentRef', () => {
    it('resolves a unique name to its id', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [agent1, agent2],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        expect(await resolveAgentRef(client(), 'Sales Bot')).toBe('agt_2')
    })

    it('follows pagination to find a name on a later page', async () => {
        const pool = mock.get(BASE)
        pool.intercept({ path: '/api/v2/agents', method: 'GET' }).reply(200, {
            data: [agent1],
            pagination: { cursor: 'cur_2', hasMore: true, total: 2 }
        })
        pool.intercept({
            path: '/api/v2/agents',
            method: 'GET',
            query: { cursor: 'cur_2' }
        }).reply(200, {
            data: [agent2],
            pagination: { cursor: null, hasMore: false, total: 2 }
        })
        expect(await resolveAgentRef(client(), 'Sales Bot')).toBe('agt_2')
    })

    it('throws listing candidates when a name is ambiguous', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [agent1, agent3],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        let error: unknown
        try {
            await resolveAgentRef(client(), 'Support Bot')
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(UsageError)
        const message = (error as Error).message
        expect(message).toContain('Support Bot (agt_1)')
        expect(message).toContain('Support Bot (agt_3)')
        expect(message).toContain('-a')
    })

    it('throws suggesting agents list when no name matches', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [agent1],
                pagination: { cursor: null, hasMore: false, total: 1 }
            })
        let error: unknown
        try {
            await resolveAgentRef(client(), 'nope')
        } catch (e) {
            error = e
        }
        expect(error).toBeInstanceOf(UsageError)
        expect((error as Error).message).toContain('chatbase agents list')
    })
})
