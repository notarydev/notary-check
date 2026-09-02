// Shared server-only helper: resolves the signed-in Clerk user to their
// Notary organization + API key, replacing the duplicated auth()/
// currentUser()/resolveOrganization() blocks that used to live separately in
// account/page.tsx and account/actions.ts.
//
// Why this exists: POST /v1/internal/resolve-organization (engine side)
// deliberately mints a FRESH API key on every call — see
// engine/src/routes/internal.ts's own comment. Calling resolveOrganization()
// from every page load and every server action would mint a new, permanently
// live, unrevoked key per request. To avoid that, the resolved org+key are
// cached on the Clerk user's own privateMetadata after the first resolve, and
// read from there on every subsequent request instead of re-resolving.
// privateMetadata is never sent to the browser by Clerk (only
// publicMetadata/unsafeMetadata are exposed client-side), so caching a live
// API key there does not leak it to the client bundle or devtools.

import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { auth, currentUser, clerkClient } from "@clerk/nextjs/server";
import { resolveOrganization } from "./engine";

export interface CurrentOrg {
  clerkUserId: string;
  email: string | undefined;
  organizationId: string;
  apiKey: string;
}

/**
 * cache() dedupes calls within one request/render pass only — it does not
 * persist across requests. The privateMetadata read/write below is what
 * actually stops repeated key minting across page navigations; cache() is
 * just an optimization on top so dashboard/layout.tsx and the page it wraps
 * don't each independently trigger the metadata round-trip in one render.
 */
export const getCurrentOrg = cache(async (): Promise<CurrentOrg> => {
  const { userId } = await auth();
  if (!userId) {
    redirect("/");
  }

  const user = await currentUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress;

  const cachedOrganizationId = user?.privateMetadata?.notaryOrganizationId;
  const cachedApiKey = user?.privateMetadata?.notaryApiKey;
  if (typeof cachedOrganizationId === "string" && typeof cachedApiKey === "string") {
    return { clerkUserId: userId, email, organizationId: cachedOrganizationId, apiKey: cachedApiKey };
  }

  const resolved = await resolveOrganization(userId, email);

  // Best-effort cache write: if this fails, the user still gets a working
  // response this request (resolved above), just at the cost of minting
  // another key next time. Never let a metadata-write failure surface as a
  // page error.
  try {
    const client = await clerkClient();
    await client.users.updateUserMetadata(userId, {
      privateMetadata: {
        notaryOrganizationId: resolved.organizationId,
        notaryApiKey: resolved.apiKey,
      },
    });
  } catch {
    // Swallow — see comment above.
  }

  return { clerkUserId: userId, email, organizationId: resolved.organizationId, apiKey: resolved.apiKey };
});
