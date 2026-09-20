import pg from "pg";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/Users/kunalkumar/Kunal/calude-workshop/incidentOs/.env" });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000, max: 1 });
for (let i = 0; i < 90; i++) {
  const rows = (await pool.query(`SELECT i.service, i.source, i.status,
    (SELECT count(*) FROM incident_phases p WHERE p.incident_id=i.id AND p.status='done')::int AS done
    FROM incoming_incidents i ORDER BY i.created_at`)).rows;
  console.log(`[${i*10}s] ` + rows.map((r: any) => `${r.service}=${r.status}(${r.done}/4)`).join("  "));
  if (rows.every((r: any) => r.status === "review" || r.status === "failed")) break;
  await new Promise(r => setTimeout(r, 10000));
}
await pool.end();
