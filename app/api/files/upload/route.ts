import path from "node:path";
import { writeBinaryFile } from "@/lib/file-manager";
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

export async function POST(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN"],
    rateLimit: {
      key: "file-upload",
      limit: 30,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  try {
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
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this path", { status: 403 });
    }
    if (code === "EEXIST") {
      return textResponse(request, "File already exists", { status: 409 });
    }
    console.error(err);
    return textResponse(request, "Failed to upload file", { status: 500 });
  }
}

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}
