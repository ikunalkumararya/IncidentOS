import { redirect } from "next/navigation";

/** /dashboard is not a page of its own — it opens the first tab. */
export default function DashboardIndex() {
  redirect("/dashboard/incident-analysis");
}
