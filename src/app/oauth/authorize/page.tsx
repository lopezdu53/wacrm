// ============================================================
// GET /oauth/authorize — the consent screen.
//
// An MCP client redirects the account owner's browser here with
// `client_id`, `redirect_uri`, `state`, and a PKCE `code_challenge`.
// This page:
//   1. Validates `client_id` and (critically) that `redirect_uri` is
//      EXACTLY one this client registered — the standard defense
//      against an attacker reusing someone else's client_id with
//      their own callback URL to steal a code. A mismatch here
//      renders an in-page error; we never redirect to an
//      unvalidated URL.
//   2. Requires the visitor to be logged into wacrm as admin+ (the
//      same bar as minting an API key by hand) — not logged in,
//      bounces to /login?next=<this URL> first.
//   3. Shows which scopes would be granted (preselecting a safe
//      default) and an Allow / Deny choice.
// Approving mints an authorization code (not a token yet — see
// /oauth/token) bound to this account, this client, and the PKCE
// challenge, then redirects back to `redirect_uri` with `code` and
// `state`, exactly like any OAuth 2.1 authorization endpoint.
// ============================================================

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getClient, createAuthCode } from '@/lib/oauth/store';
import { requireRole, UnauthorizedError } from '@/lib/auth/account';
import { API_SCOPES, SCOPE_DESCRIPTIONS, isApiScope } from '@/lib/api-keys/scopes';

export const dynamic = 'force-dynamic';

// A safe, read-heavy default — the visitor can still widen or narrow
// it with the checkboxes before approving. Omits broadcasts:send,
// webhooks:manage, and products:write: higher-blast-radius scopes an
// MCP client shouldn't get without a deliberate opt-in.
const DEFAULT_SCOPES = [
  'contacts:read',
  'contacts:write',
  'conversations:read',
  'messages:read',
  'messages:send',
  'deals:read',
  'sso:login',
];

function ErrorPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 text-center">
        <h1 className="text-lg font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const get = (key: string): string => {
    const v = params[key];
    return typeof v === 'string' ? v : '';
  };

  const clientId = get('client_id');
  const redirectUri = get('redirect_uri');
  const state = get('state');
  const responseType = get('response_type');
  const codeChallenge = get('code_challenge');
  const codeChallengeMethod = get('code_challenge_method');

  if (!clientId || !redirectUri) {
    return (
      <ErrorPage title="Solicitud inválida">
        Falta client_id o redirect_uri. Esta página no se abre directamente — un cliente MCP
        debe llegar aquí como parte del flujo de autorización.
      </ErrorPage>
    );
  }

  const client = await getClient(clientId);
  if (!client) {
    return <ErrorPage title="Cliente no reconocido">Este client_id no está registrado.</ErrorPage>;
  }
  if (!client.redirect_uris.includes(redirectUri)) {
    return (
      <ErrorPage title="redirect_uri no coincide">
        Esta URL de retorno no fue registrada por este cliente. Por seguridad, no se continúa.
      </ErrorPage>
    );
  }

  // From here on redirect_uri is trusted (exact match against what
  // the client itself registered), so later errors can safely bounce
  // back to it with ?error=... instead of dead-ending on this page.
  const authorizeUrl = `/oauth/authorize?${new URLSearchParams(
    Object.entries(params).flatMap(([k, v]) =>
      v === undefined ? [] : Array.isArray(v) ? v.map((vv) => [k, vv] as [string, string]) : [[k, v] as [string, string]],
    ),
  ).toString()}`;

  let accountId: string;
  let userId: string;
  try {
    const ctx = await requireRole('admin');
    accountId = ctx.accountId;
    userId = ctx.userId;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      redirect(`/login?next=${encodeURIComponent(authorizeUrl)}`);
    }
    return (
      <ErrorPage title="No tienes permiso">
        Conectar un cliente MCP requiere un rol de administrador en tu cuenta wacrm.
      </ErrorPage>
    );
  }

  function denyUrl(): string {
    const url = new URL(redirectUri);
    url.searchParams.set('error', 'access_denied');
    if (state) url.searchParams.set('state', state);
    return url.toString();
  }

  if (responseType !== 'code' || codeChallengeMethod !== 'S256' || !codeChallenge) {
    redirect(denyUrl());
  }

  async function decide(formData: FormData) {
    'use server';
    const approved = formData.get('decision') === 'allow';
    const redirectUri = String(formData.get('redirect_uri'));
    const state = String(formData.get('state') || '');
    const codeChallenge = String(formData.get('code_challenge'));
    const clientId = String(formData.get('client_id'));

    // Re-validate client_id/redirect_uri server-side — the form's
    // hidden fields are client-submitted and MUST NOT be trusted on
    // their own. Without this, a tampered redirect_uri would hand an
    // authorization code to an attacker-controlled URL.
    const client = await getClient(clientId);
    if (!client || !client.redirect_uris.includes(redirectUri)) {
      throw new Error('Invalid client or redirect_uri');
    }

    if (!approved) {
      const url = new URL(redirectUri);
      url.searchParams.set('error', 'access_denied');
      if (state) url.searchParams.set('state', state);
      redirect(url.toString());
    }

    const ctx = await requireRole('admin');
    const scopes = API_SCOPES.filter((s) => formData.get(`scope:${s}`) === 'on');

    const code = await createAuthCode({
      clientId,
      accountId: ctx.accountId,
      userId: ctx.userId,
      codeChallenge,
      redirectUri,
      scopes,
    });

    const url = new URL(redirectUri);
    url.searchParams.set('code', code);
    if (state) url.searchParams.set('state', state);
    redirect(url.toString());
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6">
        <h1 className="text-lg font-semibold text-foreground">Conectar con wacrm</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          <strong className="text-foreground">{client.client_name || 'Un cliente MCP'}</strong> quiere
          acceder a tu cuenta de wacrm. Va a poder usar los permisos que marques abajo.
        </p>

        <form action={decide} className="mt-5 space-y-4">
          <input type="hidden" name="redirect_uri" value={redirectUri} />
          <input type="hidden" name="state" value={state} />
          <input type="hidden" name="code_challenge" value={codeChallenge} />
          <input type="hidden" name="client_id" value={clientId} />

          <div className="space-y-2 rounded-lg border border-border p-3">
            {API_SCOPES.map((scope) => (
              <label key={scope} className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  name={`scope:${scope}`}
                  defaultChecked={DEFAULT_SCOPES.includes(scope) && isApiScope(scope)}
                  className="mt-1"
                />
                <span>
                  <span className="block font-mono text-xs text-foreground">{scope}</span>
                  <span className="block text-xs text-muted-foreground">{SCOPE_DESCRIPTIONS[scope]}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              name="decision"
              value="deny"
              className="flex-1 rounded-md border border-border bg-muted px-4 py-2 text-sm text-muted-foreground hover:bg-muted/80"
            >
              Cancelar
            </button>
            <button
              type="submit"
              name="decision"
              value="allow"
              className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Permitir
            </button>
          </div>
        </form>

        <p className="mt-4 text-center text-xs text-muted-foreground">
          <Link href="/settings/api-keys" className="hover:text-foreground">
            Puedes revocar este acceso después en Configuración → Claves de API
          </Link>
        </p>
      </div>
    </div>
  );
}
