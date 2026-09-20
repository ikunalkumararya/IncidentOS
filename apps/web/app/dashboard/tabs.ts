/**
 * The dashboard's sections. Separate from layout.tsx because Next restricts
 * what a route file may export — a layout cannot also export a constant.
 */
export const TABS = [
  { href: "/dashboard/incident-analysis", label: "Incident analysis" },
  { href: "/dashboard/attack-analysis", label: "Attack analysis" },
] as const;
