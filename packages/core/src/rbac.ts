import { z } from "zod";

export const ROLES = ["engineer", "analyst", "manager", "admin"] as const;
export type Role = (typeof ROLES)[number];
export const RoleSchema = z.enum(ROLES);

export const PERMISSIONS = [
  "docs:read",
  "docs:write",
  "machine:read",
  "workorder:read",
  "workorder:write",
  "parts:read",
  "parts:write",
  "metrics:read",
  "dashboard:read",
  "dashboard:write",
  "dashboard:share",
  "admin:users",
  "admin:connectors",
  "admin:toolkits",
  "admin:knowledge",
  "admin:audit",
  "admin:usage",
  "admin:assets",
  "workflow:read",
  "workflow:write",
  "workflow:execute",
  "connector:read",
  "connector:write",
  "alert:read",
  "alert:write",
  "alert:acknowledge",
  "notification:read",
  "notification:write",
  "queue:read",
  "queue:write",
  "license:manage"
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export const PermissionSchema = z.enum(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  engineer: new Set<Permission>([
    "docs:read",
    "machine:read",
    "workorder:read",
    "workorder:write",
    "parts:read",
    "parts:write",
    "dashboard:read",
    "workflow:read",
    "workflow:execute",
    "connector:read",
    "alert:read",
    "alert:acknowledge",
    "notification:read",
    "queue:read"
  ]),
  analyst: new Set<Permission>([
    "docs:read",
    "machine:read",
    "workorder:read",
    "parts:read",
    "metrics:read",
    "dashboard:read",
    "dashboard:write",
    "dashboard:share",
    "workflow:read",
    "workflow:write",
    "workflow:execute",
    "connector:read",
    "alert:read",
    "alert:write",
    "notification:read",
    "queue:read"
  ]),
  manager: new Set<Permission>([
    "docs:read",
    "machine:read",
    "workorder:read",
    "parts:read",
    "metrics:read",
    "dashboard:read",
    "workflow:read",
    "connector:read",
    "alert:read",
    "alert:acknowledge",
    "notification:read",
    "notification:write",
    "queue:read"
  ]),
  admin: new Set<Permission>(PERMISSIONS)
};

export interface SessionUser {
  userId: string;
  tenantId: string;
  role: Role;
  plantIds: string[];
  email: string;
  name: string;
}

export interface ResourceScope {
  tenantId?: string;
  plantId?: string;
  plantIds?: string[];
  ownerId?: string;
  sharedWithRoles?: Role[];
  sharedWithPlants?: string[];
}

export class AuthorizationError extends Error {
  public readonly statusCode = 403;
  public readonly code = "FORBIDDEN";

  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function getPermissionsForRole(role: Role): Permission[] {
  return Array.from(ROLE_PERMISSIONS[role] ?? []);
}

export function can(
  user: SessionUser | null | undefined,
  permission: Permission,
  resource?: ResourceScope
): boolean {
  try {
    authorize(user, permission, resource);
    return true;
  } catch {
    return false;
  }
}

/**
 * Single enforcement point for RBAC, tenant isolation, and server-side plant scoping.
 * Every API route, MCP tool call, and dashboard widget evaluation must call authorize().
 */
export function authorize(
  user: SessionUser | null | undefined,
  permission: Permission,
  resource?: ResourceScope
): SessionUser {
  if (!user) {
    throw new AuthorizationError("Authentication required");
  }

  if (resource?.tenantId && resource.tenantId !== user.tenantId) {
    throw new AuthorizationError("Cross-tenant resource access denied");
  }

  if (!hasPermission(user.role, permission)) {
    throw new AuthorizationError(
      `Role '${user.role}' does not have permission '${permission}'`
    );
  }

  if (resource?.plantId) {
    if (!user.plantIds.includes(resource.plantId)) {
      throw new AuthorizationError(
        `User is not authorized for plant '${resource.plantId}'`
      );
    }
  }

  if (resource?.plantIds && resource.plantIds.length > 0) {
    const outOfScope = resource.plantIds.filter(
      (pid) => !user.plantIds.includes(pid)
    );
    if (outOfScope.length > 0) {
      throw new AuthorizationError(
        `User is not authorized for plant(s): ${outOfScope.join(", ")}`
      );
    }
  }

  return user;
}

export function isDashboardSharedWithUser(
  user: SessionUser,
  dashboard: {
    tenantId: string;
    ownerId: string;
    plantScope?: string[];
    shares?: Array<{ shareType: "role" | "plant"; targetId: string }>;
  }
): boolean {
  if (dashboard.tenantId !== user.tenantId) return false;
  if (user.role === "admin" || dashboard.ownerId === user.userId) return true;

  const shares = dashboard.shares ?? [];
  const roleShared = shares.some(
    (s) => s.shareType === "role" && s.targetId === user.role
  );
  const plantShared = shares.some(
    (s) => s.shareType === "plant" && user.plantIds.includes(s.targetId)
  );
  return roleShared || plantShared;
}
