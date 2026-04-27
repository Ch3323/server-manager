const PROTECTED_CONTAINER_NAMES = new Set([
  "server-manager-app",
  "server-manager-db",
]);

export function normalizeContainerName(name: string | undefined | null) {
  return name?.replace(/^\/+/, "") ?? "";
}

export function isProtectedContainerName(name: string | undefined | null) {
  return PROTECTED_CONTAINER_NAMES.has(normalizeContainerName(name));
}
