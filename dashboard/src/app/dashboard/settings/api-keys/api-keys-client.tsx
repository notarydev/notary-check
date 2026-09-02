"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { createApiKey, revokeApiKeyAction } from "./actions";
import type { ApiKeySummary } from "@/lib/settings";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function ApiKeysClient({ apiKeys }: { apiKeys: ApiKeySummary[] }) {
  const [isCreating, startCreate] = useTransition();
  const [isRevoking, startRevoke] = useTransition();

  // The plaintext of a just-issued key, shown exactly once. Never populated
  // from anything other than the immediate createApiKey() response.
  const [newKey, setNewKey] = useState<{ plaintextKey: string; keyPrefix: string } | null>(null);

  const [revokeTarget, setRevokeTarget] = useState<ApiKeySummary | null>(null);

  const liveKeyCount = apiKeys.filter((k) => !k.revokedAt).length;

  function handleCreate() {
    startCreate(async () => {
      try {
        const issued = await createApiKey();
        setNewKey({ plaintextKey: issued.plaintextKey, keyPrefix: issued.keyPrefix });
        toast.success("New API key issued");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to issue API key");
      }
    });
  }

  function handleRevoke() {
    if (!revokeTarget) return;
    const target = revokeTarget;
    startRevoke(async () => {
      try {
        await revokeApiKeyAction(target.id);
        toast.success(`Revoked key ${target.keyPrefix}`);
        setRevokeTarget(null);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to revoke API key");
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={handleCreate} disabled={isCreating}>
          {isCreating ? "Issuing…" : "New API key"}
        </Button>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Key</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {apiKeys.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  No API keys yet.
                </TableCell>
              </TableRow>
            ) : (
              apiKeys.map((key) => (
                <TableRow key={key.id}>
                  <TableCell className="font-mono">{key.keyPrefix}…</TableCell>
                  <TableCell>{formatDate(key.createdAt)}</TableCell>
                  <TableCell>
                    {key.revokedAt ? (
                      <Badge variant="outline">Revoked</Badge>
                    ) : (
                      <Badge variant="secondary">Live</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {!key.revokedAt && (
                      <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(key)}>
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* One-time plaintext display, right after issuance. */}
      <Dialog open={newKey !== null} onOpenChange={(open) => !open && setNewKey(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your new API key</DialogTitle>
            <DialogDescription>
              Copy this now — for security, Notary cannot show it to you again. If you lose it, revoke this key and
              issue a new one.
            </DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="flex gap-2">
              <Input readOnly value={newKey.plaintextKey} className="font-mono text-xs" />
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(newKey.plaintextKey).catch(() => {});
                  toast.success("Copied to clipboard");
                }}
              >
                Copy
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewKey(null)}>
              Done, I&apos;ve saved it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke confirmation. */}
      <Dialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API key {revokeTarget?.keyPrefix}?</DialogTitle>
            <DialogDescription>
              Anything using this key — including any Claude connector configured with it — will stop working
              immediately. This cannot be undone.
              {revokeTarget && liveKeyCount <= 1 && (
                <span className="mt-2 block font-medium text-amber-600 dark:text-amber-500">
                  This is your organization&apos;s last live key. Revoking it will leave you with none, which will
                  break any connector (including the Claude MCP connector) depending on it until you issue a new
                  one.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleRevoke} disabled={isRevoking}>
              {isRevoking ? "Revoking…" : "Revoke key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
