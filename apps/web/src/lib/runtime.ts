import { startBackgroundRuntime } from "@kojo/core";
import { getWebAdministrativeDb } from "./db";

export function ensureBackgroundRuntime(): void {
  startBackgroundRuntime(getWebAdministrativeDb);
}
