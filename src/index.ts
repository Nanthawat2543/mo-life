import { app } from "./app";
import { config } from "./config";
import { startScheduler } from "./services/scheduler";

// Local / always-on host entry point (not used by Vercel serverless).
app.listen(config.port, () => {
  console.log(`[mo-life] Server running on port ${config.port}`);
  startScheduler();
});
