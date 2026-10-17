import type { Role } from "./types";

/** Shared by login, navigation and optimistic proxy redirects. */
export function homePathForRole(role: Role): string {
  return role === "super_admin" ? "/super-admin" : "/dashboard";
}
