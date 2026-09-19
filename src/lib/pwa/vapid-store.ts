import webpush from "web-push";

import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getVapidConfig, vapidSubject, type VapidConfig } from "./vapid";

let resolved: VapidConfig | null | undefined;

export function resetVapidCache(): void {
  resolved = undefined;
}

/**
 * Env keys, or the singleton `push_vapid` row, or generate + store one.
 * Returns null only when keys are missing and migration 052 is not applied.
 */
export async function resolveVapidConfig(): Promise<VapidConfig | null> {
  if (resolved !== undefined) return resolved;

  const fromEnv = getVapidConfig();
  if (fromEnv) {
    resolved = fromEnv;
    return fromEnv;
  }

  try {
    const db = supabaseAdmin();
    const { data } = await db
      .from("push_vapid")
      .select("public_key, private_key")
      .maybeSingle();
    if (data?.public_key && data?.private_key) {
      resolved = {
        publicKey: data.public_key as string,
        privateKey: data.private_key as string,
        subject: vapidSubject(),
      };
      return resolved;
    }

    const keys = webpush.generateVAPIDKeys();
    const { error } = await db.from("push_vapid").insert({
      public_key: keys.publicKey,
      private_key: keys.privateKey,
    });
    if (error) {
      const { data: again } = await db
        .from("push_vapid")
        .select("public_key, private_key")
        .maybeSingle();
      if (again?.public_key && again?.private_key) {
        resolved = {
          publicKey: again.public_key as string,
          privateKey: again.private_key as string,
          subject: vapidSubject(),
        };
        return resolved;
      }
      console.warn(
        "[pwa] push_vapid insert failed (apply migration 052):",
        error.message,
      );
      resolved = null;
      return null;
    }
    resolved = {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      subject: vapidSubject(),
    };
    return resolved;
  } catch (err) {
    console.warn("[pwa] resolveVapidConfig failed:", err);
    resolved = null;
    return null;
  }
}
