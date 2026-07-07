import path from "node:path";
import {
  abortChunkUploadSession,
  appendChunkToUploadSession,
  createChunkUploadSession,
  finalizeChunkUploadSession,
  writeBinaryFile,
} from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

function joinPath(base: string, name: string) {
  if (!base) return name;
  return `${base}/${name}`;
}

function sanitizeRelativePath(input: string) {
  const normalized = path.posix.normalize(input.replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized === "..") {
    throw new Error("Invalid relative path");
  }
  if (normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    throw new Error("Path traversal not allowed");
  }
  return normalized.replace(/^\/+/, "");
}

function getChunkSize() {
  return 32 * 1024 * 1024;
}

function resolveChunkSize(requestedChunkSize: unknown) {
  const defaultChunkSize = getChunkSize();
  const maxChunkSize = getChunkSize();
  const minChunkSize = 256 * 1024;
  const parsedChunkSize = Number(requestedChunkSize ?? Number.NaN);

  if (!Number.isInteger(parsedChunkSize) || parsedChunkSize <= 0) {
    return defaultChunkSize;
  }

  return Math.min(maxChunkSize, Math.max(minChunkSize, parsedChunkSize));
}

async function requireUploadAccess(request: Request, limitKey: string, limit: number) {
  return requireApiSession(request, {
    roles: ["ADMIN"],
    rateLimit: {
      key: limitKey,
      limit,
      windowMs: 60_000,
    },
  });
}

async function handleLegacyFormUpload(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");
  const directoryPath = typeof formData.get("directoryPath") === "string"
    ? String(formData.get("directoryPath"))
    : "";
  const relativePath = typeof formData.get("relativePath") === "string"
    ? String(formData.get("relativePath"))
    : "";
  const overwrite = String(formData.get("overwrite") ?? "false") === "true";

  if (!(file instanceof File)) {
    return textResponse(request, "file required", { status: 400 });
  }

  const targetRelativePath = relativePath
    ? sanitizeRelativePath(relativePath)
    : sanitizeRelativePath(path.posix.basename(file.name.replace(/\\/g, "/")));
  const targetPath = joinPath(directoryPath, targetRelativePath);
  const binaryContent = new Uint8Array(await file.arrayBuffer());

  await writeBinaryFile(targetPath, binaryContent, { overwrite });
  return jsonResponse(request, {
    success: true,
    path: targetPath,
    name: path.posix.basename(targetRelativePath),
    size: file.size,
  });
}

export async function POST(request: Request) {
  const auth = await requireUploadAccess(request, "file-upload-control", 5_000);

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const contentType = request.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
      return await handleLegacyFormUpload(request);
    }

    const body = await request.json();
    const action = typeof body?.action === "string" ? body.action : "";

    if (action === "init") {
      const directoryPath = typeof body?.directoryPath === "string" ? body.directoryPath : "";
      const relativePath = typeof body?.relativePath === "string" ? body.relativePath : "";
      const fileName = typeof body?.fileName === "string" ? body.fileName : "";
      const overwrite = body?.overwrite === true;
      const size = Number(body?.size ?? Number.NaN);
      const chunkSize = resolveChunkSize(body?.chunkSize);

      const targetRelativePath = relativePath
        ? sanitizeRelativePath(relativePath)
        : sanitizeRelativePath(path.posix.basename(fileName.replace(/\\/g, "/")));
      const targetPath = joinPath(directoryPath, targetRelativePath);
      const session = await createChunkUploadSession(targetPath, { overwrite, size, chunkSize });

      return jsonResponse(request, {
        success: true,
        uploadId: session.id,
        chunkSize,
        totalChunks: session.totalChunks,
        path: targetPath,
      });
    }

    if (action === "complete") {
      const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
      if (!uploadId) {
        return textResponse(request, "uploadId required", { status: 400 });
      }

      const uploadedFile = await finalizeChunkUploadSession(uploadId);
      return jsonResponse(request, {
        success: true,
        ...uploadedFile,
      });
    }

    if (action === "abort") {
      const uploadId = typeof body?.uploadId === "string" ? body.uploadId : "";
      if (!uploadId) {
        return textResponse(request, "uploadId required", { status: 400 });
      }

      await abortChunkUploadSession(uploadId);
      return jsonResponse(request, { success: true });
    }

    return textResponse(request, "Unsupported upload action", { status: 400 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this path", { status: 403 });
    }
    if (code === "EEXIST") {
      return textResponse(request, "File already exists", { status: 409 });
    }
    if (code === "ERANGE" || code === "EBADMSG") {
      return textResponse(request, "Upload chunk is invalid or incomplete", { status: 409 });
    }
    if (code === "ENOENT") {
      return textResponse(request, "Upload session not found", { status: 404 });
    }
    console.error(err);
    return textResponse(request, "Failed to upload file", { status: 500 });
  }
}

export async function PUT(request: Request) {
  const auth = await requireUploadAccess(request, "file-upload-chunk", 30_000);

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const url = new URL(request.url);
    const uploadId = url.searchParams.get("uploadId") ?? "";
    const offset = Number(url.searchParams.get("offset") ?? Number.NaN);

    if (!uploadId) {
      return textResponse(request, "uploadId required", { status: 400 });
    }
    if (!Number.isInteger(offset) || offset < 0) {
      return textResponse(request, "offset required", { status: 400 });
    }

    const chunk = new Uint8Array(await request.arrayBuffer());
    const session = await appendChunkToUploadSession(uploadId, chunk, offset);
    return jsonResponse(request, {
      success: true,
      receivedBytes: session.receivedBytes,
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this path", { status: 403 });
    }
    if (code === "EEXIST") {
      return textResponse(request, "File already exists", { status: 409 });
    }
    if (code === "ERANGE" || code === "EBADMSG") {
      return textResponse(request, "Upload chunk is invalid or incomplete", { status: 409 });
    }
    if (code === "ENOENT") {
      return textResponse(request, "Upload session not found", { status: 404 });
    }
    console.error(err);
    return textResponse(request, "Failed to store upload chunk", { status: 500 });
  }
}

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}
