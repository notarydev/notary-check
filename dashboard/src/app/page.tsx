import Link from "next/link";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { WaitlistForm } from "@/components/waitlist-form";

// The "soft" half of the signup gate: defaults CLOSED (waitlist-only) on
// purpose. The canonical build plan blocks public self-serve signup/payment
// until the held-out eval gate passes, which it hasn't yet (see
// docs/build/architecture-and-progress.md). Flipping this to "open" is a
// deliberate two-part action — this env var AND turning off Clerk's own
// Restricted sign-up mode (the "hard" half, configured in the Clerk
// dashboard, outside this codebase) — by design, so opening signup can't
// happen by accident from either half alone.
const SIGNUP_MODE = process.env.NOTARY_SIGNUP_MODE === "open" ? "open" : "waitlist";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <nav className="fixed top-0 inset-x-0 flex items-center justify-between px-8 py-4">
        <span className="font-semibold tracking-tight text-black dark:text-zinc-50">
          Notary Check
        </span>
        <div className="flex items-center gap-3">
          <Show when="signed-out">
            <SignInButton>
              <button className="rounded-full border border-solid border-black/[.08] px-4 py-2 text-sm font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]">
                Sign in
              </button>
            </SignInButton>
            {SIGNUP_MODE === "open" ? (
              <SignUpButton>
                <button className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]">
                  Sign up
                </button>
              </SignUpButton>
            ) : null}
          </Show>
          <Show when="signed-in">
            <Link
              href="/account"
              className="rounded-full border border-solid border-black/[.08] px-4 py-2 text-sm font-medium transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Account &amp; billing
            </Link>
            <UserButton />
          </Show>
        </div>
      </nav>

      <main className="flex flex-1 w-full max-w-3xl flex-col items-center justify-center py-32 px-16 text-center">
        <h1 className="max-w-md text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
          Notary Check dashboard
        </h1>
        <p className="mt-4 max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
          Sign in to manage your organization&apos;s Notary Check evidence
          reviews, API keys, and billing.
        </p>
        {SIGNUP_MODE === "waitlist" ? (
          <Show when="signed-out">
            <p className="mt-8 text-sm text-zinc-500 dark:text-zinc-400">
              New here? We&apos;re onboarding a limited cohort right now.
            </p>
            <WaitlistForm className="mt-3 w-full max-w-sm" />
          </Show>
        ) : null}
      </main>
    </div>
  );
}
