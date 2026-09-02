import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { getCurrentOrg } from "@/lib/currentOrg";
import { listReviews } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Visual chrome only — mirrors the engine's own review.status values
// ("processing" | "complete" | "failed"), never rephrases them.
function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "complete":
      return "default";
    case "failed":
      return "destructive";
    case "processing":
      return "secondary";
    default:
      return "outline";
  }
}

export default async function ReviewsPage({ searchParams }: PageProps<"/dashboard/reviews">) {
  const { cursor } = await searchParams;
  const org = await getCurrentOrg();
  const { reviews, next_cursor } = await listReviews(org.apiKey, {
    limit: 20,
    cursor: typeof cursor === "string" ? cursor : undefined,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reviews</CardTitle>
        <CardDescription>Review history for your organization.</CardDescription>
      </CardHeader>
      <CardContent>
        {reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No reviews yet. Reviews created through the API will show up here.
          </p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Completed</TableHead>
                  <TableHead className="text-right">Idempotency key</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reviews.map((review) => (
                  <TableRow key={review.id}>
                    <TableCell>
                      <Badge variant={statusVariant(review.status)}>{review.status}</Badge>
                    </TableCell>
                    <TableCell>
                      <Link href={`/dashboard/reviews/${review.id}`}>{new Date(review.created_at).toLocaleString()}</Link>
                    </TableCell>
                    <TableCell>
                      {review.completed_at ? new Date(review.completed_at).toLocaleString() : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-muted-foreground">
                      {review.idempotency_key ?? "—"}
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
                  render={<Link href={`/dashboard/reviews?cursor=${encodeURIComponent(next_cursor)}`} />}
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
