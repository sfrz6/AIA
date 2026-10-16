/**
 * Capability based permissions.
 *
 * Administrators implicitly hold every capability. Every other user holds only
 * the capabilities explicitly granted to them. Capabilities are checked on the
 * server for every protected action; hiding a button is a convenience, never a
 * security boundary.
 */
export const PERMISSIONS = [
  "MANAGE_TEMPLATES",
  "CREATE_CHAMPIONSHIP",
  "EDIT_CHAMPIONSHIP",
  "MANAGE_CHAMPIONSHIP_COUNTRIES",
  "MANAGE_RIDERS",
  "MANAGE_ENTRY_ORDERS",
  "ENTER_SCORES",
  "CONFIRM_RUNS",
  "EDIT_CONFIRMED_RESULTS",
  "MANAGE_TIE_BREAKS",
  "PRINT_ROUND_SHEETS",
  "VIEW_INTERNAL_RESULTS",
  "MANAGE_PUBLIC_RESULTS",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Grouping used only to lay out the permission editor in the user interface. */
export const PERMISSION_GROUPS: ReadonlyArray<{
  readonly id: string;
  readonly permissions: readonly Permission[];
}> = [
  { id: "setup", permissions: ["MANAGE_TEMPLATES", "CREATE_CHAMPIONSHIP", "EDIT_CHAMPIONSHIP"] },
  {
    id: "participants",
    permissions: ["MANAGE_CHAMPIONSHIP_COUNTRIES", "MANAGE_RIDERS", "MANAGE_ENTRY_ORDERS"],
  },
  {
    id: "operations",
    permissions: ["ENTER_SCORES", "CONFIRM_RUNS", "EDIT_CONFIRMED_RESULTS", "PRINT_ROUND_SHEETS"],
  },
  {
    id: "results",
    permissions: ["MANAGE_TIE_BREAKS", "VIEW_INTERNAL_RESULTS", "MANAGE_PUBLIC_RESULTS"],
  },
];

export interface PrincipalLike {
  readonly isAdmin: boolean;
  readonly permissions: readonly Permission[];
}

export function hasPermission(principal: PrincipalLike, permission: Permission): boolean {
  return principal.isAdmin || principal.permissions.includes(permission);
}

export function hasAnyPermission(
  principal: PrincipalLike,
  permissions: readonly Permission[],
): boolean {
  return principal.isAdmin || permissions.some((p) => principal.permissions.includes(p));
}

export function hasAllPermissions(
  principal: PrincipalLike,
  permissions: readonly Permission[],
): boolean {
  return principal.isAdmin || permissions.every((p) => principal.permissions.includes(p));
}

/** Capabilities an administrator holds, listed explicitly for display. */
export function effectivePermissions(principal: PrincipalLike): readonly Permission[] {
  return principal.isAdmin ? PERMISSIONS : principal.permissions;
}
