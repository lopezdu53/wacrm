import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

/**
 * POST /api/inbox/internal-comment
 *
 * Adds an internal team note to a conversation thread. Stored in
 * `messages` with `is_internal = true` so it interleaves with the chat,
 * but it is NEVER sent to WhatsApp. Body: { conversation_id, text }.
 *
 * Auth + account-scoping via the RLS client; the insert uses the service
 * role (after verifying the conversation belongs to the caller's account)
 * so it doesn't depend on the messages-table insert policy.
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();
    const accountId = profile?.account_id as string | undefined;
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => null)) as {
      conversation_id?: string;
      text?: string;
    } | null;
    const conversationId = body?.conversation_id?.trim();
    const text = body?.text?.trim();
    if (!conversationId || !text) {
      return NextResponse.json(
        { error: 'conversation_id and text are required.' },
        { status: 400 },
      );
    }

    // The conversation must belong to the caller's account.
    const { data: conv } = await supabase
      .from('conversations')
      .select('id')
      .eq('id', conversationId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!conv) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    const admin = createAdminClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { data: inserted, error: insertError } = await admin
      .from('messages')
      .insert({
        conversation_id: conversationId,
        sender_type: 'agent',
        sender_id: user.id,
        content_type: 'text',
        content_text: text,
        is_internal: true,
        status: 'sent',
      })
      .select()
      .single();

    if (insertError) {
      console.error('[internal-comment] insert failed:', insertError);
      return NextResponse.json({ error: 'Failed to save comment' }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: inserted });
  } catch (err) {
    console.error('[internal-comment] failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
