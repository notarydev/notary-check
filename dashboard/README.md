# Notary Check — dashboard

Next.js 16 App Router app. Two real pages: `/` (landing + sign-in/sign-up)
and `/account` (billing — Stripe checkout via a server action, gated behind
Clerk auth, `redirect("/")` if unauthenticated).

Auth is Clerk (`@clerk/nextjs`), on a custom Frontend API domain
(`clerk.getnotary.ai`). Middleware lives at `src/proxy.ts`, not
`middleware.ts` — Next 16.0+ renamed the convention; if you go looking for
middleware and don't find it where you expect, this is why.

See [`../docs/build/architecture-and-progress.md`](../docs/build/architecture-and-progress.md)
for what's actually live (Clerk keys are `pk_live_`/`sk_live_` in
`.env.local`; Stripe is currently test-mode only, not live payment).

## Setup

```bash
cd dashboard
npm install
cp .env.example .env.local         # then set Clerk + Stripe keys
npm run dev                        # http://localhost:3000
```

## Commands

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run lint` — lint
