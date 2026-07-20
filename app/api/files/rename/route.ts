import { renamePath } from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";
import {
  getFileWorkspaceAccess,
  requireWorkspaceWriteAccess,
  resolveScopedWorkspacePath,
} from "@/lib/workspace-access";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN", "MOD"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const workspaceAccess = await getFileWorkspaceAccess(auth.session);
    if (!workspaceAccess) {
      return textResponse(request, "Forbidden", { status: 403 });
    }
    requireWorkspaceWriteAccess(workspaceAccess);

    const body = await request.json();
    const fromPath = typeof body?.fromPath === "string" ? body.fromPath : "";
    const toPath = typeof body?.toPath === "string" ? body.toPath : "";

    if (!fromPath || !toPath) {
      return textResponse(request, "fromPath and toPath required", { status: 400 });
    }

    const scopedFromPath = resolveScopedWorkspacePath(workspaceAccess, fromPath);
    const scopedToPath = resolveScopedWorkspacePath(workspaceAccess, toPath);
    await renamePath(scopedFromPath.actualPath, scopedToPath.actualPath);
    return jsonResponse(request, { success: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this path", { status: 403 });
    }
    console.error(err);
    return textResponse(request, "Failed to rename path", { status: 500 });
  }
}
