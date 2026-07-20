import { readTextFile } from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";
import {
  getFileWorkspaceAccess,
  resolveScopedWorkspacePath,
} from "@/lib/workspace-access";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN", "MOD"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const workspaceAccess = await getFileWorkspaceAccess(auth.session);
    if (!workspaceAccess) {
      return textResponse(request, "Forbidden", { status: 403 });
    }

    const url = new URL(request.url);
    const targetPath = url.searchParams.get("path");

    if (!targetPath) {
      return textResponse(request, "path required", { status: 400 });
    }

    const scopedPath = resolveScopedWorkspacePath(workspaceAccess, targetPath);
    const content = await readTextFile(scopedPath.actualPath);
    return jsonResponse(request, { path: scopedPath.virtualPath, content });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this path", { status: 403 });
    }
    console.error(err);
    return textResponse(request, "Failed to read file", { status: 500 });
  }
}
