import { initPersistence, closePersistence } from "./pool.js";

try {
  const result = await initPersistence();
  if (!result.ok) {
    console.error("Schema initialization failed. Run pnpm db:check to check connectivity and configuration.");
    process.exitCode = 1;
  } else {
    console.log("Database schema ready. No demo accounts were created.");
  }
} finally {
  await closePersistence();
}
