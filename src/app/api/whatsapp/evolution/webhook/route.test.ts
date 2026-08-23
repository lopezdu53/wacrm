import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const configRow: Record<string, unknown> = {
    id: 'cfg-1',
    account_id: 'acct-1',
    user_id: 'user-1',
    evolution_instance: 'ventas',
    evolution_api_key: 'enc-good',
    evolution_base_url: 'https://evo.example',
    provider: 'evolution',
  }
  const chain = (): Record<string, unknown> => ({
    select: () => chain(),
    eq: () => chain(),
    ilike: () => chain(),
    limit: () => chain(),
    maybeSingle: async () => ({ data: configRow, error: null }),
  })
  return {
    processEvolutionItem: vi.fn(async () => 'recorded'),
    decrypt: vi.fn((enc: string) =>
      enc === 'enc-good' ? 'plain-secret' : 'other',
    ),
    verifyEvolutionApiKey: vi.fn(async () => false),
    configRow,
    chain,
  }
})

const { processEvolutionItem, decrypt, verifyEvolutionApiKey, configRow } = h

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => h.chain(),
  }),
}))

vi.mock('@/lib/whatsapp/evolution-api', () => ({
  verifyEvolutionApiKey: h.verifyEvolutionApiKey,
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
    verifyEvolutionApiKey.mockClear().mockResolvedValue(false)
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

  it('accepts Evolution instance token that the server recognizes', async () => {
    verifyEvolutionApiKey.mockResolvedValueOnce(true)
    const res = await post(
      {
        event: 'MESSAGES_UPSERT',
        instance: 'ventas',
        apikey: 'instance-token-not-the-global-key',
        data: { key: { remoteJid: '1@s.whatsapp.net', id: 'm1' } },
      },
    )
    expect(res.status).toBe(200)
    expect(processEvolutionItem).toHaveBeenCalledTimes(1)
    expect(verifyEvolutionApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        apiKey: 'instance-token-not-the-global-key',
        instance: 'ventas',
      }),
    )
  })

  it('ignores non-upsert events without checking the key', async () => {
    const res = await post({ event: 'connection.update', instance: 'ventas' })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.ignored).toBe(true)
    expect(processEvolutionItem).not.toHaveBeenCalled()
  })
})
