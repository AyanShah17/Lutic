export const BOARD_STATUSES = [
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled"
] as const;

export const BOARD_PRIORITIES = ["urgent", "high", "medium", "low"] as const;

export const BOARD_CATEGORIES = [
  "operations",
  "automation",
  "incident",
  "connector",
  "agent"
] as const;
