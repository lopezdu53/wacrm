import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // A deleted Auth user (owner wiped their workspace) leaves a refresh
  // cookie that makes getUser() throw or hang. That wedges every reload
  // until cookies are cleared by hand. Fail closed to "logged out" and
  // drop the dead session.
  let user: { id: string } | null = null
  let authFailed = false
  let authTimer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        authTimer = setTimeout(() => reject(new Error('auth timeout')), 4000)
      }),
    ])
    user = result.data.user ?? null
  } catch {
    authFailed = true
    user = null
  } finally {
    if (authTimer) clearTimeout(authTimer)
  }

  // getUser() transparently refreshes an expired access token, which
  // ROTATES the refresh token and writes the new cookies onto
  // `supabaseResponse` via setAll() above. Any response we return in
  // place of `supabaseResponse` (every redirect / JSON branch below)
  // is a fresh object that does NOT carry those Set-Cookie headers, so
  // the rotated token never reaches the browser. The next request then
  // replays the old, now-consumed refresh token, the refresh fails, and
  // the session wedges — the user gets a broken reload after idling and
  // can only recover by manually clearing cookies (issue #288). Copy the
  // refreshed cookies onto whatever response we hand back to fix that.
  const withRefreshedCookies = <T extends NextResponse>(response: T): T => {
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      response.cookies.set(cookie)
    })
    return response
  }

  const clearAuthCookies = <T extends NextResponse>(response: T): T => {
    request.cookies.getAll().forEach(({ name }) => {
      if (name.startsWith('sb-')) {
        response.cookies.set(name, '', { path: '/', maxAge: 0 })
      }
    })
    return response
  }

  const finalize = <T extends NextResponse>(response: T): T => {
    const withCookies = withRefreshedCookies(response)
    return authFailed ? clearAuthCookies(withCookies) : withCookies
  }

  // Auth pages - redirect to dashboard if already logged in.
  // Exception: when an invite token is in the query string we
  // send the already-signed-in user to /join/<token> instead so
  // they can accept the invitation in one click. Without this,
  // a forwarded invite link to someone who's already signed in
  // would silently drop them on /dashboard.
  if (user && (
    request.nextUrl.pathname === '/login' ||
    request.nextUrl.pathname === '/signup' ||
    request.nextUrl.pathname === '/forgot-password'
  )) {
    const url = request.nextUrl.clone()
    const inviteToken = request.nextUrl.searchParams.get('invite')
    if (
      inviteToken &&
      (request.nextUrl.pathname === '/login' ||
        request.nextUrl.pathname === '/signup')
    ) {
      url.pathname = `/join/${encodeURIComponent(inviteToken)}`
      url.search = ''
    } else {
      url.pathname = '/dashboard'
      url.search = ''
    }
    return finalize(NextResponse.redirect(url))
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = [
    '/dashboard',
    '/inbox',
    '/contacts',
    '/pipelines',
    '/broadcasts',
    '/automations',
    '/settings',
    '/flows',
    '/agents',
    '/internal-chat',
    '/notifications',
  ]
  if (!user && protectedPaths.some(path => request.nextUrl.pathname.startsWith(path))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return finalize(NextResponse.redirect(url))
  }

  // API routes that need a session. Public exceptions: Meta/Evolution
  // webhooks, public REST (`/api/v1` uses API keys), cron pingers,
  // and invitation peek (token in the URL). Everything else 401s
  // here so a new route can't ship unauthenticated by accident.
  const pathname = request.nextUrl.pathname
  const publicApi =
    pathname.startsWith('/api/v1/') ||
    pathname === '/api/whatsapp/webhook' ||
    pathname === '/api/whatsapp/evolution/webhook' ||
    pathname.startsWith('/api/whatsapp/evolution/webhook/') ||
    pathname === '/api/automations/cron' ||
    pathname === '/api/flows/cron' ||
    pathname.includes('/webhook') ||
    /\/api\/invitations\/[^/]+\/peek$/.test(pathname)
  if (!user && pathname.startsWith('/api/') && !publicApi) {
    return finalize(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    )
  }

  return finalize(supabaseResponse)
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
