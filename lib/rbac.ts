type Role = "ADMIN" | "MOD" | "USER";

export function hasPermission(
  userRole: Role,
  required: Role[]
): boolean {
  return required.includes(userRole);
}