import { readTextFile } from "@/lib/file-manager";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN", "MOD"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const url = new URL(request.url);
    const targetPath = url.searchParams.get("path");

    if (!targetPath) {
      return textResponse(request, "path required", { status: 400 });
    }

    const content = await readTextFile(targetPath);
    return jsonResponse(request, { path: targetPath, content });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Failed to read file", { status: 500 });
  }
}
