import path from "node:path";

import { prisma } from "@/lib/prisma";
import {
  FileListItem,
  getWorkspaceRootName,
  resolveWorkspacePath,
  toRelativeWorkspacePath,
  toWorkspaceHostPath,
} from "@/lib/file-manager";
import type { AppSession } from "@/lib/getSession";

export type WorkspaceAccessMode = "VIEW" | "EDIT";

export type FileWorkspaceAccess = {
  rootPath: string;
  accessMode: WorkspaceAccessMode;
  canWrite: boolean;
};

type FileWorkspaceAccessError = Error & { code?: string };

function normalizeRelative(inputPath: string) {
  return inputPath.replace(/\\/g, "/").replace(/^\/+/, "");
}

function createAccessDeniedError() {
  const error = new Error("Path is outside assigned workspace") as FileWorkspaceAccessError;
  error.code = "EACCES";
  return error;
}

function isPathWithin(parentPath: string, targetPath: string) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function normalizeWorkspaceAccessPath(inputPath: string) {
  const normalized = normalizeRelative(inputPath.trim());
  return toRelativeWorkspacePath(resolveWorkspacePath(normalized));
}

export async function getFileWorkspaceAccess(session: AppSession) {
  if (session.user.role === "ADMIN") {
    return {
      rootPath: "",
      accessMode: "EDIT",
      canWrite: true,
    } satisfies FileWorkspaceAccess;
  }

  if (session.user.role !== "MOD") {
    return null;
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: {
      workspacePath: true,
      workspaceAccess: true,
    },
  });

  if (!user) {
    return null;
  }

  const accessMode = user.workspaceAccess === "EDIT" ? "EDIT" : "VIEW";

  return {
    rootPath: normalizeWorkspaceAccessPath(user.workspacePath ?? ""),
    accessMode,
    canWrite: accessMode === "EDIT",
  } satisfies FileWorkspaceAccess;
}

export function requireWorkspaceWriteAccess(access: FileWorkspaceAccess) {
  if (!access.canWrite) {
    throw createAccessDeniedError();
  }
}

export function resolveScopedWorkspacePath(
  access: FileWorkspaceAccess,
  relativePath = ""
) {
  const rootAbsolutePath = resolveWorkspacePath(access.rootPath);
  const targetAbsolutePath = path.resolve(rootAbsolutePath, normalizeRelative(relativePath));

  if (!isPathWithin(rootAbsolutePath, targetAbsolutePath)) {
    throw createAccessDeniedError();
  }

  return {
    absolutePath: targetAbsolutePath,
    actualPath: toRelativeWorkspacePath(targetAbsolutePath),
    virtualPath: normalizeRelative(path.relative(rootAbsolutePath, targetAbsolutePath)),
  };
}

export function assertActualWorkspacePathInScope(
  access: FileWorkspaceAccess,
  actualPath: string
) {
  const rootAbsolutePath = resolveWorkspacePath(access.rootPath);
  const targetAbsolutePath = resolveWorkspacePath(actualPath);

  if (!isPathWithin(rootAbsolutePath, targetAbsolutePath)) {
    throw createAccessDeniedError();
  }
}

export function toVirtualWorkspacePath(access: FileWorkspaceAccess, actualPath: string) {
  const rootAbsolutePath = resolveWorkspacePath(access.rootPath);
  const targetAbsolutePath = resolveWorkspacePath(actualPath);

  if (!isPathWithin(rootAbsolutePath, targetAbsolutePath)) {
    throw createAccessDeniedError();
  }

  return normalizeRelative(path.relative(rootAbsolutePath, targetAbsolutePath));
}

export function toVirtualFileListEntries(
  access: FileWorkspaceAccess,
  entries: FileListItem[]
) {
  return entries.map((entry) => ({
    ...entry,
    path: toVirtualWorkspacePath(access, entry.path),
  }));
}

export function getScopedWorkspaceRootName(access: FileWorkspaceAccess) {
  const rootName = getWorkspaceRootName();
  return access.rootPath ? `${rootName}/${access.rootPath}` : rootName;
}

export function toScopedWorkspaceHostPath(access: FileWorkspaceAccess, virtualPath = "") {
  const scopedPath = resolveScopedWorkspacePath(access, virtualPath);
  return toWorkspaceHostPath(scopedPath.actualPath);
}
