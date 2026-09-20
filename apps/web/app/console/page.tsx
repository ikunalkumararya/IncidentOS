import { permanentRedirect } from "next/navigation";

/**
 * The console is now the incident-analysis tab of the dashboard. Kept as a
 * redirect so existing links and bookmarks still land somewhere useful.
 */
export default function ConsoleRedirect() {
  permanentRedirect("/dashboard/incident-analysis");
}
