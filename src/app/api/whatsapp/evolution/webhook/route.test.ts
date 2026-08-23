import { beforeEach, describe, expect, it, vi } from 'vitest'

const processEvolutionItem = vi.fn(async () => 'recorded')
const decrypt = vi.fn((enc: string) =>
  enc === 'enc-good' ? 'plain-secret' : 'other',
)

const configRow: Record<string, unknown> | null = {
  id: 'cfg-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  evolution_instance: 'ventas',
  evolution_api_key: 'enc-good',
  provider: 'evolution',
}

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: configRow, error: null }),
          }),
        }),
      }),
    }),
  }),
}))

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: (enc: string) => decrypt(enc),
}))

vi.mock('@/lib/whatsapp/evolution-inbound', () => ({
  processEvolutionItem,
}))

const { POST } = await import('./route')

function post(body: unknown, headers?: Record<string, string>) {
  return POST(
    new Request('http://localhost/api/whatsapp/evolution/webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )
}

describe('POST /api/whatsapp/evolution/webhook', () => {
  beforeEach(() => {
    processEvolutionItem.mockClear()
    configRow.id = 'cfg-1'
    configRow.evolution_api_key = 'enc-good'
  })

  it('401s when the apikey is missing', async () => {
    const res = await post({
      event: 'messages.upsert',
      instance: 'ventas',
      data: { key: { remoteJid: '1@s.whatsapp.net', id: 'm1' } },
    })
    expect(res.status).toBe(401)
    expect(processEvolutionItem).not.toHaveBeenCalled()
  })

  it('401s when the apikey does not match', async () => {
    const res = await post(
      { event: 'messages.upsert', instance: 'ventas', data: {} },
      { apikey: 'wrong-secret' },
    )
    expect(res.status).toBe(401)
    expect(processEvolutionItem).not.toHaveBeenCalled()
  })

  it('accepts a matching apikey header and records the item', async () => {
    const res = await post(
      {
        event: 'messages.upsert',
        instance: 'ventas',
        data: { key: { remoteJid: '1@s.whatsapp.net', id: 'm1' } },
      },
      { apikey: 'plain-secret' },
    )
    expect(res.status).toBe(200)
    expect(processEvolutionItem).toHaveBeenCalledTimes(1)
  })

  it('accepts a matching apikey in the body', async () => {
    const res = await post({
      event: 'messages.upsert',
      instance: 'ventas',
      apikey: 'plain-secret',
      data: { key: { remoteJid: '1@s.whatsapp.net', id: 'm1' } },
    })
    expect(res.status).toBe(200)
    expect(processEvolutionItem).toHaveBeenCalled()
  })

  it('ignores non-upsert events without checking the key', async () => {
    const res = await post({ event: 'connection.update', instance: 'ventas' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ignored).toBe(true)
    expect(processEvolutionItem).not.toHaveBeenCalled()
  })
})
