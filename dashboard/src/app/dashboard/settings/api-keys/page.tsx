import { getCurrentOrg } from "@/lib/currentOrg";
import { listApiKeys } from "@/lib/settings";
import { ApiKeysClient } from "./api-keys-client";

export default async function ApiKeysPage() {
  const { apiKey } = await getCurrentOrg();
  const keys = await listApiKeys(apiKey);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API keys</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Issue and revoke API keys for this organization. A new key&apos;s plaintext is shown once, right after
          issuance — Notary cannot show it to you again afterward.
        </p>
      </div>
      <ApiKeysClient apiKeys={keys} />
    </div>
  );
}
