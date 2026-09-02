import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { getCurrentOrg } from "@/lib/currentOrg";
import { listEvidence } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Visual chrome only — mirrors evidence.retrieval_status as returned by the
// engine, never rephrased.
function retrievalVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "retrieved":
      return "default";
    case "failed":
      return "destructive";
    case "pending":
      return "secondary";
    default:
      return "outline";
  }
}

export default async function EvidencePage({ searchParams }: PageProps<"/dashboard/evidence">) {
  const { cursor } = await searchParams;
  const org = await getCurrentOrg();
  const { evidence, next_cursor } = await listEvidence(org.apiKey, {
    limit: 20,
    cursor: typeof cursor === "string" ? cursor : undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence</CardTitle>
        <CardDescription>Evidence library for your organization.</CardDescription>
      </CardHeader>
      <CardContent>
        {evidence.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No evidence registered yet. Sources added to a review will show up here.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Origin</TableHead>
                  <TableHead>Retrieval status</TableHead>
                  <TableHead>URL</TableHead>
                  <TableHead className="text-right">Retention until</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evidence.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.origin}</TableCell>
                    <TableCell>
                      <Badge variant={retrievalVariant(item.retrieval_status)}>{item.retrieval_status}</Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {item.canonical_url || item.submitted_url ? (
                        <a
                          href={item.canonical_url ?? item.submitted_url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="underline text-muted-foreground"
                        >
                          {item.canonical_url ?? item.submitted_url}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.retention_until ? new Date(item.retention_until).toLocaleDateString() : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {next_cursor && (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  render={<Link href={`/dashboard/evidence?cursor=${encodeURIComponent(next_cursor)}`} />}
                >
                  Load more
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
