"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { joinWaitlist, type JoinWaitlistResult } from "@/app/waitlist-actions";

const initialState: JoinWaitlistResult = { ok: false };

/**
 * The "soft" half of the signup gate (see NOTARY_SIGNUP_MODE in
 * app/page.tsx) — rendered instead of Clerk's sign-up flow while public
 * self-serve signup is closed. Submits to POST /v1/waitlist via the
 * joinWaitlist server action; approval is a manual ops step (see
 * engine/src/routes/waitlist.ts and the waitlist_signup table), not
 * automated here.
 */
export function WaitlistForm({ className }: { className?: string }) {
  const [state, formAction, pending] = useActionState(joinWaitlist, initialState);

  if (state.ok) {
    return (
      <p className={className}>
        You&apos;re on the list — we&apos;ll email you when a spot opens up.
      </p>
    );
  }

  return (
    <form action={formAction} className={className}>
      <div className="flex w-full max-w-sm items-center gap-2">
        <Input type="email" name="email" placeholder="you@company.com" required disabled={pending} />
        <Button type="submit" disabled={pending}>
          {pending ? "Joining…" : "Join waitlist"}
        </Button>
      </div>
      {state.error ? <p className="mt-2 text-sm text-destructive">{state.error}</p> : null}
    </form>
  );
}
