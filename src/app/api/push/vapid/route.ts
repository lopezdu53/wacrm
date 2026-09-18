import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { getVapidConfig } from "@/lib/pwa/vapid";

/** Public VAPID key for PushManager.subscribe. Auth-gated so the
 *  key isn't advertised on an open endpoint; it is not secret. */
export async function GET() {
  try {
    await getCurrentAccount();
  } catch (err) {
    return toErrorResponse(err);
  }

  const cfg = getVapidConfig();
  if (!cfg) {
    return NextResponse.json({ configured: false, publicKey: null });
  }
  return NextResponse.json({ configured: true, publicKey: cfg.publicKey });
}
