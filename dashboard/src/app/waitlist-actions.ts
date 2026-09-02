"use server";

import { submitWaitlist } from "@/lib/engine";

export interface JoinWaitlistResult {
  ok: boolean;
  error?: string;
}

/**
 * Server action backing the landing page's waitlist form (rendered instead
 * of Clerk sign-up while NOTARY_SIGNUP_MODE=waitlist — see page.tsx). Public
 * and unauthenticated by design; the engine's own POST /v1/waitlist applies
 * its own validation/rate-limiting, this is just the client-facing wrapper.
 */
export async function joinWaitlist(_prevState: JoinWaitlistResult, formData: FormData): Promise<JoinWaitlistResult> {
  const email = formData.get("email");
  if (typeof email !== "string" || email.trim().length === 0) {
    return { ok: false, error: "Enter an email address." };
  }

  try {
    await submitWaitlist(email.trim());
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong. Try again." };
  }
}
