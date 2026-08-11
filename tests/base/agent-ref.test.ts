import { MockAgent, setGlobalDispatcher } from 'undici'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveAgentRef } from '../../src/base/agent-ref.js'
import { createApiClient } from '../../src/client/client.js'
import { UsageError } from '../../src/errors/errors.js'

const BASE = 'https://www.chatbase.co'
let mock: MockAgent

const agent1 = { id: 'agt_1', name: 'Support Bot' }
const agent2 = { id: 'agt_2', name: 'Sales Bot' }
const agent3 = { id: 'agt_3', name: 'Support Bot' } // duplicate name, distinct id

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
    it('matches an exact id and reports resolvedFromName: false', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [agent1, agent2],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        const result = await resolveAgentRef(client(), 'agt_1')
        expect(result).toEqual({ id: 'agt_1', resolvedFromName: false })
    })

    it('matches a unique exact name and reports resolvedFromName: true', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [agent1, agent2],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        const result = await resolveAgentRef(client(), 'Sales Bot')
        expect(result).toEqual({ id: 'agt_2', resolvedFromName: true })
    })

    it('prefers an id match even when the ref also equals another agent’s name', async () => {
        mock.get(BASE)
            .intercept({ path: '/api/v2/agents', method: 'GET' })
            .reply(200, {
                data: [agent1, { id: 'agt_9', name: 'agt_1' }],
                pagination: { cursor: null, hasMore: false, total: 2 }
            })
        const result = await resolveAgentRef(client(), 'agt_1')
        expect(result).toEqual({ id: 'agt_1', resolvedFromName: false })
    })

    it('follows pagination to the end before matching by id', async () => {
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
        const result = await resolveAgentRef(client(), 'agt_2')
        expect(result).toEqual({ id: 'agt_2', resolvedFromName: false })
    })

    it('throws a UsageError listing every candidate "name (id)" when a name is ambiguous', async () => {
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
        expect(message.toLowerCase()).toContain('id')
    })

    it('throws a UsageError suggesting `chatbase agents list` when nothing matches', async () => {
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
