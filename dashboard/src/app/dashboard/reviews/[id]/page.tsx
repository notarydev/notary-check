import { notFound } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getCurrentOrg } from "@/lib/currentOrg";
import { getReview } from "@/lib/engine";

export const dynamic = "force-dynamic";

// Visual chrome only, layered on top of the engine's own claim.state values
// — never rephrased, never invented. Anything not recognized falls back to
// "outline" rather than guessing at a new label.
function stateVariant(state: string): "default" | "secondary" | "destructive" | "outline" {
  switch (state) {
    case "SUPPORTED":
      return "default";
    case "CONTRADICTED":
      return "destructive";
    case "UNSUPPORTED":
    case "INDETERMINATE":
      return "secondary";
    default:
      return "outline";
  }
}

function reviewStatusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
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

export default async function ReviewDetailPage({ params }: PageProps<"/dashboard/reviews/[id]">) {
  const { id } = await params;
  const org = await getCurrentOrg();
  const detail = await getReview(org.apiKey, id);

  if (!detail) {
    notFound();
  }

  const { review, claims } = detail;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle>Review {review.id}</CardTitle>
            <Badge variant={reviewStatusVariant(review.status)}>{review.status}</Badge>
          </div>
          <CardDescription>
            Created {new Date(review.created_at).toLocaleString()}
            {review.completed_at ? ` · Completed ${new Date(review.completed_at).toLocaleString()}` : ""}
            {review.idempotency_key ? ` · Idempotency key: ${review.idempotency_key}` : ""}
          </CardDescription>
        </CardHeader>
      </Card>

      {claims.length === 0 ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">No claims recorded for this review yet.</p>
          </CardContent>
        </Card>
      ) : (
        claims.map((claim) => (
          <Card key={claim.id}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Claim {claim.ordinal + 1}</CardTitle>
                <Badge variant={stateVariant(claim.state)}>{claim.state}</Badge>
                {claim.no_source && <Badge variant="outline">no source</Badge>}
                {claim.materiality && <Badge variant="outline">material</Badge>}
              </div>
              <CardDescription>{claim.text}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {claim.state_reason && (
                <p className="text-sm text-muted-foreground">{claim.state_reason}</p>
              )}

              {claim.evidence_matches.length === 0 ? (
                <p className="text-sm text-muted-foreground">No evidence matches for this claim.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  <Separator />
                  {claim.evidence_matches.map((match) => (
                    <div key={match.id} className="flex flex-col gap-1 rounded-md border p-3 text-sm">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{match.relation}</Badge>
                        <span className="text-muted-foreground">{match.evidence.origin}</span>
                        <Badge variant="outline">{match.evidence.retrieval_status}</Badge>
                      </div>
                      {(match.evidence.canonical_url || match.evidence.submitted_url) && (
                        <a
                          href={match.evidence.canonical_url ?? match.evidence.submitted_url ?? undefined}
                          target="_blank"
                          rel="noreferrer"
                          className="truncate text-xs text-muted-foreground underline"
                        >
                          {match.evidence.canonical_url ?? match.evidence.submitted_url}
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
