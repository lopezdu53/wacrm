'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Drop the local session and send the browser to /login without
 * calling Auth's remote revoke. Needed after the owner deletes their
 * own account: the Auth user is already gone, and a remote signOut()
 * (token refresh + revoke) wedges the tab so reload never finishes.
 */
export function hardRedirectToLogin(): void {
  try {
    void createClient().auth.signOut({ scope: 'local' });
  } catch {
    // The client may already be in a broken lock state.
  }

  if (typeof document !== 'undefined') {
    for (const part of document.cookie.split(';')) {
      const name = part.split('=')[0]?.trim();
      if (name?.startsWith('sb-')) {
        document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
      }
    }
  }

  window.location.replace('/login');
}
