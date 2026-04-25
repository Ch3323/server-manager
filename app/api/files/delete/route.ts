import { deletePath } from "@/lib/file-manager";
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
    const targetPath = typeof body?.path === "string" ? body.path : "";

    if (!targetPath) {
      return textResponse(request, "path required", { status: 400 });
    }

    await deletePath(targetPath);
    return jsonResponse(request, { success: true });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "EACCES" || code === "EPERM") {
      return textResponse(request, "Access denied for this path", { status: 403 });
    }
    console.error(err);
    return textResponse(request, "Failed to delete path", { status: 500 });
  }
}
