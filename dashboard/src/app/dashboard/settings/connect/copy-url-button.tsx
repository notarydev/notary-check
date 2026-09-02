"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function CopyUrlButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => {
        navigator.clipboard
          .writeText(url)
          .then(() => {
            setCopied(true);
            toast.success("Connector URL copied");
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => toast.error("Couldn't copy — select and copy the URL manually"));
      }}
    >
      {copied ? "Copied!" : "Copy"}
    </Button>
  );
}
