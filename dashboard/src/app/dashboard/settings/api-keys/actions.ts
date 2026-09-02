"use server";

import { revalidatePath } from "next/cache";
import { getCurrentOrg } from "@/lib/currentOrg";
import { issueApiKey, revokeApiKey } from "@/lib/settings";

/**
 * Issues a new API key for the signed-in user's organization. Returns the
 * one-time plaintext key — the caller (client component) is responsible for
 * showing it to the user exactly once and never persisting it.
 */
export async function createApiKey(): Promise<{ id: string; plaintextKey: string; keyPrefix: string }> {
  const { apiKey } = await getCurrentOrg();
  const issued = await issueApiKey(apiKey);
  revalidatePath("/dashboard/settings/api-keys");
  return issued;
}

/** Revokes one of the organization's API keys. Idempotent on double-revoke. */
export async function revokeApiKeyAction(keyId: string): Promise<void> {
  const { apiKey } = await getCurrentOrg();
  await revokeApiKey(apiKey, keyId);
  revalidatePath("/dashboard/settings/api-keys");
}
