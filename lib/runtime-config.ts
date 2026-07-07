import path from "node:path";

function resolveFromCwd(inputPath: string) {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), inputPath);
}

export function getWorkspaceRoot() {
  const configuredRoot = process.env.FILE_MANAGER_ROOT?.trim();
  return configuredRoot
    ? resolveFromCwd(configuredRoot)
    : path.resolve(/* turbopackIgnore: true */ process.cwd());
}

export function getWorkspaceHostRoot() {
  const configuredRoot = process.env.FILE_MANAGER_HOST_ROOT?.trim();
  return configuredRoot ? path.resolve(configuredRoot) : getWorkspaceRoot();
}

export function getWorkspaceRootLabel() {
  const workspaceRoot = getWorkspaceRoot();
  const normalized = workspaceRoot.replace(/\\/g, "/");
  return path.basename(normalized) || normalized;
}

export function getTerminalStartPath() {
  const configuredPath = process.env.TERMINAL_ROOT_PATH?.trim();
  return configuredPath ? resolveFromCwd(configuredPath) : getWorkspaceRoot();
}

function splitEnvPaths(value: string) {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getProtectedFileManagerPaths() {
  const configured = process.env.FILE_MANAGER_PROTECTED_PATHS?.trim();
  const defaultPaths =
    process.platform === "win32"
      ? []
      : ["/etc", "/boot", "/proc", "/sys", "/dev"];

  const sourcePaths = configured ? splitEnvPaths(configured) : defaultPaths;

  return sourcePaths.map((entry) =>
    path.isAbsolute(entry) ? path.resolve(entry) : resolveFromCwd(entry)
  );
}
