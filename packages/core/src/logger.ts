import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password",
      "passwordHash",
      "encryptedCredentials",
      "credentials",
      "authorization",
      "cookie",
      "*.password",
      "*.passwordHash",
      "*.encryptedCredentials",
      "*.apiKey",
      "*.token"
    ],
    censor: "[REDACTED]"
  },
  base: {
    service: "lutic"
  }
});

export function createRequestLogger(requestId: string, context?: Record<string, unknown>) {
  return logger.child({ requestId, ...context });
}
