import path from "node:path";
import { promises as fs } from "node:fs";

const workspaceRoot = path.parse(process.cwd()).root;

export type FileListItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
};

function normalizeRelative(inputPath: string) {
  const normalized = inputPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized;
}

export function resolveWorkspacePath(relativePath = "") {
  const normalized = normalizeRelative(relativePath);
  const absolute = path.resolve(workspaceRoot, normalized);
  const relative = path.relative(workspaceRoot, absolute);
  const isOutsideWorkspace = relative.startsWith("..") || path.isAbsolute(relative);
  if (isOutsideWorkspace) {
    throw new Error("Path is outside workspace");
  }

  return absolute;
}

export function toRelativeWorkspacePath(absolutePath: string) {
  const relative = path.relative(workspaceRoot, absolutePath);
  return normalizeRelative(relative);
}

export async function listDirectory(relativePath = "") {
  const absolute = resolveWorkspacePath(relativePath);
  const dirents = await fs.readdir(absolute, { withFileTypes: true });

  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const itemAbsolute = path.join(absolute, dirent.name);
      try {
        if (dirent.isDirectory()) {
          // Skip directories we cannot traverse, so users don't hit hard errors
          // when trying to open protected/system folders.
          const directory = await fs.opendir(itemAbsolute);
          await directory.close();
        }

        const stats = await fs.stat(itemAbsolute);
        return {
          name: dirent.name,
          path: toRelativeWorkspacePath(itemAbsolute),
          type: dirent.isDirectory() ? "directory" : "file",
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
        } as FileListItem;
      } catch {
        // Skip entries that are inaccessible (e.g. protected system folders).
        return null;
      }
    })
  );

  return entries.filter((entry): entry is FileListItem => entry !== null).sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export async function readTextFile(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  return fs.readFile(absolute, "utf8");
}

export async function writeTextFile(relativePath: string, content: string) {
  const absolute = resolveWorkspacePath(relativePath);
  await fs.writeFile(absolute, content, "utf8");
}

export async function writeBinaryFile(
  relativePath: string,
  content: Uint8Array,
  options?: { overwrite?: boolean }
) {
  const absolute = resolveWorkspacePath(relativePath);
  const overwrite = options?.overwrite ?? false;
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, overwrite ? undefined : { flag: "wx" });
}

export async function createFile(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  await fs.writeFile(absolute, "", { flag: "wx" });
}

export async function createDirectory(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  await fs.mkdir(absolute, { recursive: false });
}

export async function renamePath(fromPath: string, toPath: string) {
  const fromAbsolute = resolveWorkspacePath(fromPath);
  const toAbsolute = resolveWorkspacePath(toPath);
  await fs.rename(fromAbsolute, toAbsolute);
}

export async function deletePath(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  const stats = await fs.stat(absolute);

  if (stats.isDirectory()) {
    await fs.rm(absolute, { recursive: true, force: false });
    return;
  }

  await fs.unlink(absolute);
}

export function getWorkspaceRootName() {
  return workspaceRoot.replace(/\\/g, "/");
}
