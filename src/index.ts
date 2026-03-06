import { resolve } from "path";
import { Orchestrator } from "./orchestrator.js";
import { createApp } from "./api.js";
import { initGitHub } from "./github.js";
import { logger } from "./logger.js";

const WORKFLOW_PATH = resolve(process.env.WORKFLOW_PATH ?? "WORKFLOW.md");
const PORT = parseInt(process.env.PORT ?? "3000", 10);

async function main() {
  logger.info({ workflowPath: WORKFLOW_PATH, port: PORT }, "Symphony starting");

  // Initialize GitHub client
  if (!process.env.GITHUB_TOKEN) {
    logger.warn("GITHUB_TOKEN not set, GitHub API calls may be rate-limited");
  }
  initGitHub();

  // Create orchestrator
  const orchestrator = new Orchestrator(WORKFLOW_PATH);

  // Start API server
  const app = createApp(orchestrator);
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "Dashboard available");
  });

  // Start orchestrator
  orchestrator.start();

  // Graceful shutdown
  const shutdown = () => {
    logger.info("Shutting down...");
    orchestrator.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to start Symphony");
  process.exit(1);
});
