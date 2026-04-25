import { renamePath } from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const body = await request.json();
    const fromPath = typeof body?.fromPath === "string" ? body.fromPath : "";
    const toPath = typeof body?.toPath === "string" ? body.toPath : "";

    if (!fromPath || !toPath) {
      return textResponse(request, "fromPath and toPath required", { status: 400 });
    }

    await renamePath(fromPath, toPath);
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
