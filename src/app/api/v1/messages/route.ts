// ============================================================
// POST /api/v1/messages — send a WhatsApp message via the public API.
//
// The headline public endpoint (issue #245). Unlike the dashboard's
// `/api/whatsapp/send` (which takes an internal `conversation_id`),
// this takes a phone number — what an external automation actually
// has — resolves-or-creates the contact + conversation, then runs the
// same shared send core.
//
// Auth: API key with the `messages:send` scope. Account context (and
// the service-role client) come from `requireApiKey`.
//
// Body:
//   {
//     "to": "+14155550123",                 // E.164 — required unless conversation_id is set
//     "conversation_id": "<uuid>",           // reply inside an existing chat, from that chat's number
//     "from": "3134407007",                  // which connected number sends (id or label,
//                                            // see GET /api/v1/whatsapp-numbers); only with "to"
//     "type": "text",                        // text|template|image|video|document|audio (default: text)
//     "text": "Hello!",                      // text body, or media caption
//     "media_url": "https://…/file.pdf",     // required for image/video/document/audio
//     "filename": "invoice.pdf",             // optional, document filename
//     "template": {                          // required when type=template
//       "name": "order_update",
//       "language": "en_US",
//       "params": ["A123"] | { "body": [...] }   // array = positional body; object = structured
//     },
//     "reply_to_message_id": "<uuid>",       // optional, must be in the same conversation
//     "name": "Jane Doe"                     // optional, names a newly-created contact
//   }
//
// Response (201):
//   { "data": { "message_id", "whatsapp_message_id", "conversation_id",
//               "contact_id", "contact_created", "whatsapp_number" } }
// ============================================================

import { requireApiKey } from '@/lib/auth/api-context';
import { ok, fail, toApiErrorResponse } from '@/lib/api/v1/respond';
import { resolveConversationByPhone } from '@/lib/whatsapp/resolve-conversation';
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message';
import type { InteractiveMessagePayload } from '@/lib/whatsapp/interactive';
import {
  loadWhatsAppNumbers,
  findWhatsAppNumber,
  describeNumbers,
} from '@/lib/api/v1/whatsapp-numbers';

export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'messages:send');

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return fail('bad_request', 'Request body must be a JSON object', 400);
    }

    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const conversationId =
      typeof body.conversation_id === 'string'
        ? body.conversation_id.trim()
        : '';
    if (!to && !conversationId) {
      return fail(
        'bad_request',
        "'to' (a phone number) or 'conversation_id' is required",
        400
      );
    }

    // Which number sends. `whatsapp_config_id` is the original name of
    // this field and keeps working. An unknown value is an error, never
    // a silent fallback to another line: the customer would get the
    // message from a number they have never talked to.
    const fromRef =
      typeof body.from === 'string' && body.from.trim()
        ? body.from.trim()
        : typeof body.whatsapp_config_id === 'string'
          ? body.whatsapp_config_id.trim()
          : '';
    const numbers = await loadWhatsAppNumbers(ctx.supabase, ctx.accountId);
    const fromNumber = fromRef ? findWhatsAppNumber(numbers, fromRef) : null;
    if (fromRef && !fromNumber) {
      return fail(
        'bad_request',
        `Unknown WhatsApp number '${fromRef}'. Connected numbers: ${describeNumbers(numbers) || 'none'}.`,
        400
      );
    }

    const type = typeof body.type === 'string' ? body.type : 'text';

    // Unpack the optional `template` object into the flat params the
    // send core expects. `params` as an array → legacy positional body
    // params; as an object → structured header/body/button params.
    const template =
      body.template && typeof body.template === 'object'
        ? (body.template as Record<string, unknown>)
        : null;
    const templateParams = Array.isArray(template?.params)
      ? (template.params as unknown[]).filter(
          (p): p is string => typeof p === 'string'
        )
      : undefined;
    const templateMessageParams =
      template?.params && !Array.isArray(template.params)
        ? template.params
        : undefined;

    // Validate the message shape BEFORE resolveConversationByPhone
    // finds-or-creates a contact + conversation, so a bad payload 400s
    // without leaving an orphan contact/conversation behind.
    // Validated by `validateSendMessageParams` below; the cast just bridges
    // the untyped JSON body to the send-core param type.
    const interactivePayload =
      body.interactive_payload && typeof body.interactive_payload === 'object'
        ? (body.interactive_payload as InteractiveMessagePayload)
        : null;

    validateSendMessageParams({
      messageType: type,
      contentText: typeof body.text === 'string' ? body.text : null,
      mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
      templateName: typeof template?.name === 'string' ? template.name : null,
      interactivePayload,
    });

    // Either reply inside a known chat (it already belongs to a number)
    // or find-or-create the chat for this phone on the chosen number.
    // Both steps share `SendMessageError`, so one catch maps the whole
    // pipeline to the envelope.
    let resolved: {
      conversationId: string;
      contactId: string;
      contactCreated: boolean;
    };
    let usedNumberId: string | null;

    if (conversationId) {
      const { data: conv, error: convErr } = await ctx.supabase
        .from('conversations')
        .select('id, contact_id, whatsapp_config_id')
        .eq('id', conversationId)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (convErr) {
        console.error('[api/v1/messages] conversation lookup error:', convErr);
        return fail('internal', 'Failed to load conversation', 500);
      }
      if (!conv) return fail('not_found', 'Conversation not found', 404);

      usedNumberId = (conv.whatsapp_config_id as string | null) ?? null;
      if (fromNumber && usedNumberId && fromNumber.id !== usedNumberId) {
        const owner = numbers.find((n) => n.id === usedNumberId);
        return fail(
          'bad_request',
          `This conversation belongs to the number "${owner?.label ?? usedNumberId}" and can only be answered from it. To write to this contact from "${fromNumber.label}", send with 'to' + 'from' instead of 'conversation_id'.`,
          400
        );
      }
      resolved = {
        conversationId: conv.id as string,
        contactId: conv.contact_id as string,
        contactCreated: false,
      };
    } else {
      resolved = await resolveConversationByPhone(
        ctx.supabase,
        ctx.accountId,
        to,
        typeof body.name === 'string' ? body.name : null,
        { whatsappConfigId: fromNumber?.id ?? null }
      );
      const { data: conv } = await ctx.supabase
        .from('conversations')
        .select('whatsapp_config_id')
        .eq('id', resolved.conversationId)
        .maybeSingle();
      usedNumberId =
        (conv?.whatsapp_config_id as string | null | undefined) ??
        fromNumber?.id ??
        null;
    }

    const result = await sendMessageToConversation(
      ctx.supabase,
      ctx.accountId,
      {
        conversationId: resolved.conversationId,
        messageType: type,
        contentText: typeof body.text === 'string' ? body.text : null,
        mediaUrl: typeof body.media_url === 'string' ? body.media_url : null,
        filename: typeof body.filename === 'string' ? body.filename : null,
        templateName: typeof template?.name === 'string' ? template.name : null,
        templateLanguage:
          typeof template?.language === 'string' ? template.language : null,
        templateParams,
        templateMessageParams,
        interactivePayload,
        replyToMessageId:
          typeof body.reply_to_message_id === 'string'
            ? body.reply_to_message_id
            : null,
      }
    );

    return ok(
      {
        message_id: result.messageId,
        whatsapp_message_id: result.whatsappMessageId,
        conversation_id: resolved.conversationId,
        contact_id: resolved.contactId,
        contact_created: resolved.contactCreated,
        whatsapp_number: numbers.find((n) => n.id === usedNumberId) ?? null,
      },
      201
    );
  } catch (err) {
    if (err instanceof SendMessageError) {
      return fail(err.code, err.message, err.status);
    }
    return toApiErrorResponse(err);
  }
}
