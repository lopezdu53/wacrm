import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  try {
    const { mediaId } = await params

    if (!mediaId) {
      return NextResponse.json(
        { error: 'Media ID is required' },
        { status: 400 }
      )
    }

    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Resolve the caller's account_id — whatsapp_config is one-per-
    // account post-multi-user, so a teammate fetching media for a
    // conversation in the shared inbox needs the account's config,
    // not their personal (non-existent) row.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    // An account can hold several Meta numbers; a media id is only
    // fetchable with the token of the number that received it. Try
    // each Meta config until one succeeds.
    const { data: configs } = await supabase
      .from('whatsapp_config')
      .select('id, access_token')
      .eq('account_id', accountId)
      .eq('provider', 'meta')
      .order('created_at', { ascending: true })

    if (!configs || configs.length === 0) {
      return NextResponse.json(
        { error: 'WhatsApp not configured' },
        { status: 400 }
      )
    }

    let buffer: Buffer | null = null
    let contentType: string | undefined
    let mimeType: string | undefined
    let lastError: unknown = null
    for (const config of configs) {
      try {
        const accessToken = decrypt(config.access_token)
        const mediaInfo = await getMediaUrl({ mediaId, accessToken })
        const downloaded = await downloadMedia({
          downloadUrl: mediaInfo.url,
          accessToken,
        })
        buffer = downloaded.buffer
        contentType = downloaded.contentType
        mimeType = mediaInfo.mimeType
        break
      } catch (err) {
        lastError = err
      }
    }

    if (!buffer) {
      console.error('Error fetching WhatsApp media:', lastError)
      return NextResponse.json(
        { error: 'Failed to fetch media' },
        { status: 502 }
      )
    }

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mimeType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Error in WhatsApp media GET:', error)
    return NextResponse.json(
      { error: 'Failed to fetch media' },
      { status: 500 }
    )
  }
}
