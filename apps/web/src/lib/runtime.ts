import { startBackgroundRuntime } from "@lutic/core";
import { getWebAdministrativeDb } from "./db";

export function ensureBackgroundRuntime(): void {
  startBackgroundRuntime(getWebAdministrativeDb);
}
