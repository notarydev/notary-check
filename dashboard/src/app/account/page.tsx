import { redirect } from "next/navigation";

// This route's content has moved to /dashboard/settings/billing. Kept as a
// redirect stub rather than deleted outright — /account may already be
// bookmarked/in browser history for real users. See the migration note that
// used to live here (now in the git history of this file).
export default function AccountPage() {
  redirect("/dashboard/settings/billing");
}
