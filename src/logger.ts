import pino from "pino";

function getTransport(): pino.TransportSingleOptions | undefined {
  if (process.env.NODE_ENV === "production") {
    return undefined;
  }
  try {
    require.resolve("pino-pretty");
    return { target: "pino-pretty", options: { colorize: true } };
  } catch {
    return undefined;
  }
}

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport: getTransport(),
});

export function issueLogger(issueNumber: number) {
  return logger.child({ issue: issueNumber });
}
