import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "IncidentOS — Investigate. Fix. Verify.",
  description: "AI-powered SRE incident investigation and remediation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <body>{children}</body>
    </html>
  );
}
