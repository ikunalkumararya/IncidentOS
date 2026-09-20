/**
 * The dashboard's sections. Separate from layout.tsx because Next restricts
 * what a route file may export — a layout cannot also export a constant.
 */
export const TABS = [
  { href: "/dashboard/incident-analysis", label: "Incident analysis", icon: "incident" },
  { href: "/dashboard/attack-analysis", label: "Attack analysis", icon: "attack" },
] as const;
