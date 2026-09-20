import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
const req = (path: string, token?: string) => new NextRequest(`http://localhost:3000${path}`, { headers: token ? { cookie: `incidentos_session=${token}` } : {} });
afterEach(() => vi.unstubAllGlobals());
it("redirects verified users from all guest pages to the dashboard", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
  for (const path of ["/", "/signin", "/signup"]) expect((await middleware(req(path, "valid"))).headers.get("location")).toBe("http://localhost:3000/dashboard/incident-analysis");
});
it("allows guest pages for missing and invalid sessions", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  for (const token of [undefined, "expired"]) expect((await middleware(req("/signin", token))).headers.get("location")).toBeNull();
});
it("keeps sign-in accessible if the API is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect((await middleware(req("/signin", "old"))).headers.get("location")).toBeNull();
});
it("preserves the destination for signed-out dashboard visitors", async () => {
  const response = await middleware(req("/dashboard/incident-analysis?tab=open"));
  expect(new URL(response.headers.get("location")!).searchParams.get("next")).toBe("/dashboard/incident-analysis?tab=open");
  expect((await middleware(req("/dashboard/incident-analysis", "session"))).headers.get("location")).toBeNull();
});
