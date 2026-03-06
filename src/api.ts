import express from "express";
import type { Orchestrator } from "./orchestrator.js";

export function createApp(orchestrator: Orchestrator): express.Express {
  const app = express();
  // TODO: Task 9 will implement the full API + SSE + Dashboard
  return app;
}
