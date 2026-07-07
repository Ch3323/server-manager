import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import {
  getProtectedFileManagerPaths,
  getWorkspaceHostRoot,
  getWorkspaceRoot,
  getWorkspaceRootLabel,
} from "@/lib/runtime-config";

const workspaceRoot = getWorkspaceRoot();
const workspaceHostRoot = getWorkspaceHostRoot();
const protectedPaths = getProtectedFileManagerPaths();
const uploadTempDirectoryName = ".server-manager-upload-tmp";
const uploadTempRoot = path.join(workspaceRoot, uploadTempDirectoryName);

export type FileListItem = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string;
};

type FileManagerError = Error & { code?: string };

type UploadSessionRecord = {
  id: string;
  targetPath: string;
  tempFilePath: string;
  size: number;
  chunkSize: number;
  totalChunks: number;
  receivedBytes: number;
  uploadedChunks: boolean[];
  overwrite: boolean;
  createdAt: string;
};

const uploadSessionLocks = new Map<string, Promise<void>>();

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

export function toWorkspaceHostPath(relativePath = "") {
  return path.resolve(workspaceHostRoot, normalizeRelative(relativePath));
}

function createProtectedPathError(targetPath: string) {
  const error = new Error(`Protected path: ${targetPath}`) as FileManagerError;
  error.code = "EACCES";
  return error;
}

function isPathWithin(parentPath: string, targetPath: string) {
  const relative = path.relative(parentPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertPathWritable(absolutePath: string) {
  const protectedPath = protectedPaths.find((entry) => isPathWithin(entry, absolutePath));
  if (protectedPath) {
    throw createProtectedPathError(protectedPath);
  }
}

export async function listDirectory(relativePath = "") {
  const absolute = resolveWorkspacePath(relativePath);
  const dirents = await fs.readdir(absolute, { withFileTypes: true });

  const entries = await Promise.all(
    dirents.map(async (dirent) => {
      const itemAbsolute = path.join(absolute, dirent.name);
      if (itemAbsolute === uploadTempRoot) {
        return null;
      }

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
  assertPathWritable(absolute);
  await fs.writeFile(absolute, content, "utf8");
}

export async function writeBinaryFile(
  relativePath: string,
  content: Uint8Array,
  options?: { overwrite?: boolean }
) {
  const absolute = resolveWorkspacePath(relativePath);
  assertPathWritable(absolute);
  assertPathWritable(path.dirname(absolute));
  const overwrite = options?.overwrite ?? false;
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, overwrite ? undefined : { flag: "wx" });
}

function getUploadSessionMetaPath(uploadId: string) {
  return path.join(uploadTempRoot, `${uploadId}.json`);
}

function getUploadSessionChunkPath(uploadId: string) {
  return path.join(uploadTempRoot, `${uploadId}.part`);
}

async function ensureUploadTempRoot() {
  await fs.mkdir(uploadTempRoot, { recursive: true });
}

async function readUploadSession(uploadId: string) {
  const record = JSON.parse(
    await fs.readFile(getUploadSessionMetaPath(uploadId), "utf8")
  ) as UploadSessionRecord;

  return record;
}

async function writeUploadSession(record: UploadSessionRecord) {
  await fs.writeFile(
    getUploadSessionMetaPath(record.id),
    JSON.stringify(record),
    "utf8"
  );
}

async function cleanupUploadSession(uploadId: string) {
  await Promise.allSettled([
    fs.rm(getUploadSessionMetaPath(uploadId), { force: true }),
    fs.rm(getUploadSessionChunkPath(uploadId), { force: true }),
  ]);
}

async function hashFileSha256(targetPath: string) {
  const hash = createHash("sha256");

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(targetPath);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });

  return hash.digest("hex");
}

function validateUploadChunk(record: UploadSessionRecord, offset: number, chunkByteLength: number) {
  if (offset >= record.size) {
    const error = new Error("Chunk exceeds declared upload size") as FileManagerError;
    error.code = "ERANGE";
    throw error;
  }

  const chunkIndex = Math.floor(offset / record.chunkSize);
  const expectedOffset = chunkIndex * record.chunkSize;
  const expectedChunkSize = Math.min(record.chunkSize, record.size - expectedOffset);

  if (offset !== expectedOffset) {
    const error = new Error("Unexpected chunk offset") as FileManagerError;
    error.code = "ERANGE";
    throw error;
  }

  if (chunkByteLength !== expectedChunkSize) {
    const error = new Error("Unexpected chunk size") as FileManagerError;
    error.code = "ERANGE";
    throw error;
  }

  return { chunkIndex };
}

async function withUploadSessionLock<T>(uploadId: string, task: () => Promise<T>) {
  const previous = uploadSessionLocks.get(uploadId) ?? Promise.resolve();
  let releaseLock!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  const queued = previous.then(() => current);

  uploadSessionLocks.set(uploadId, queued);
  await previous;

  try {
    return await task();
  } finally {
    releaseLock();
    if (uploadSessionLocks.get(uploadId) === queued) {
      uploadSessionLocks.delete(uploadId);
    }
  }
}

export async function createChunkUploadSession(
  relativePath: string,
  options: {
    overwrite?: boolean;
    size: number;
    chunkSize: number;
  }
) {
  const absolute = resolveWorkspacePath(relativePath);
  assertPathWritable(absolute);
  assertPathWritable(path.dirname(absolute));

  if (!Number.isFinite(options.size) || options.size < 0) {
    throw new Error("Invalid upload size");
  }
  if (!Number.isInteger(options.chunkSize) || options.chunkSize <= 0) {
    throw new Error("Invalid chunk size");
  }

  if (!options.overwrite) {
    await fs.access(absolute).then(
      () => {
        const error = new Error("File already exists") as FileManagerError;
        error.code = "EEXIST";
        throw error;
      },
      () => null
    );
  }

  await ensureUploadTempRoot();

  const id = randomUUID();
  const tempFilePath = getUploadSessionChunkPath(id);
  const totalChunks = options.size === 0 ? 0 : Math.ceil(options.size / options.chunkSize);
  const record: UploadSessionRecord = {
    id,
    targetPath: absolute,
    tempFilePath,
    size: options.size,
    chunkSize: options.chunkSize,
    totalChunks,
    receivedBytes: 0,
    uploadedChunks: Array.from({ length: totalChunks }, () => false),
    overwrite: options.overwrite ?? false,
    createdAt: new Date().toISOString(),
  };

  await fs.writeFile(tempFilePath, new Uint8Array(), { flag: "wx" });
  await fs.truncate(tempFilePath, options.size);
  await writeUploadSession(record);

  return record;
}

export async function appendChunkToUploadSession(
  uploadId: string,
  chunk: Uint8Array,
  offset: number
) {
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Invalid chunk offset");
  }
  if (chunk.byteLength === 0) {
    const error = new Error("Chunk payload is empty") as FileManagerError;
    error.code = "ERANGE";
    throw error;
  }

  const initialRecord = await readUploadSession(uploadId);
  const { chunkIndex } = validateUploadChunk(initialRecord, offset, chunk.byteLength);

  const fileHandle = await fs.open(initialRecord.tempFilePath, "r+");

  try {
    await fileHandle.write(chunk, 0, chunk.byteLength, offset);
  } finally {
    await fileHandle.close();
  }

  return withUploadSessionLock(uploadId, async () => {
    const record = await readUploadSession(uploadId);
    validateUploadChunk(record, offset, chunk.byteLength);

    if (!record.uploadedChunks[chunkIndex]) {
      record.uploadedChunks[chunkIndex] = true;
      record.receivedBytes += chunk.byteLength;
      await writeUploadSession(record);
    }

    return record;
  });
}

export async function finalizeChunkUploadSession(uploadId: string) {
  return withUploadSessionLock(uploadId, async () => {
    const record = await readUploadSession(uploadId);

    const isComplete = record.receivedBytes === record.size
      && record.uploadedChunks.every((chunkUploaded) => chunkUploaded);

    if (!isComplete) {
      const error = new Error("Upload is incomplete") as FileManagerError;
      error.code = "EBADMSG";
      throw error;
    }

    assertPathWritable(record.targetPath);
    assertPathWritable(path.dirname(record.targetPath));
    await fs.mkdir(path.dirname(record.targetPath), { recursive: true });

    if (!record.overwrite) {
      await fs.access(record.targetPath).then(
        () => {
          const error = new Error("File already exists") as FileManagerError;
          error.code = "EEXIST";
          throw error;
        },
        () => null
      );
    } else {
      await fs.rm(record.targetPath, { force: true });
    }

    await fs.rename(record.tempFilePath, record.targetPath);
    await fs.rm(getUploadSessionMetaPath(uploadId), { force: true });

    let finalizedStats;
    let sha256;

    try {
      finalizedStats = await fs.stat(record.targetPath);
      if (finalizedStats.size !== record.size) {
        const error = new Error("Uploaded file size verification failed") as FileManagerError;
        error.code = "EBADMSG";
        throw error;
      }

      sha256 = await hashFileSha256(record.targetPath);
    } catch (error) {
      await fs.rm(record.targetPath, { force: true }).catch(() => undefined);
      throw error;
    }

    return {
      path: toRelativeWorkspacePath(record.targetPath),
      size: finalizedStats.size,
      name: path.basename(record.targetPath),
      verified: true,
      sha256,
    };
  });
}

export async function abortChunkUploadSession(uploadId: string) {
  await withUploadSessionLock(uploadId, async () => {
    await cleanupUploadSession(uploadId);
  });
}

export async function createFile(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  assertPathWritable(absolute);
  await fs.writeFile(absolute, "", { flag: "wx" });
}

export async function createDirectory(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  assertPathWritable(absolute);
  await fs.mkdir(absolute, { recursive: false });
}

export async function renamePath(fromPath: string, toPath: string) {
  const fromAbsolute = resolveWorkspacePath(fromPath);
  const toAbsolute = resolveWorkspacePath(toPath);
  assertPathWritable(fromAbsolute);
  assertPathWritable(toAbsolute);
  await fs.rename(fromAbsolute, toAbsolute);
}

export async function deletePath(relativePath: string) {
  const absolute = resolveWorkspacePath(relativePath);
  assertPathWritable(absolute);
  const stats = await fs.stat(absolute);

  if (stats.isDirectory()) {
    await fs.rm(absolute, { recursive: true, force: false });
    return;
  }

  await fs.unlink(absolute);
}

export function getWorkspaceRootName() {
  return getWorkspaceRootLabel();
}
