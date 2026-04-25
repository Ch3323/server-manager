import {
  createTerminalTicket,
  ensureTerminalWsServer,
  getTerminalRootPath,
  resolveWsUrlFromRequest,
} from "@/lib/terminal-ws-server";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

export const runtime = "nodejs";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN"],
    rateLimit: {
      key: "terminal-ws-ticket",
      limit: 20,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const wsServer = await ensureTerminalWsServer();
    const rootPath = getTerminalRootPath();
    const actorEmail = session.user.email ?? "unknown";

    const ticket = createTerminalTicket({
      cwd: rootPath,
      actorEmail,
    });

    const baseWsUrl = resolveWsUrlFromRequest({
      requestUrl: request.url,
      wsPort: wsServer.port,
      wsPath: wsServer.path,
    });

    return jsonResponse(request, {
      wsUrl: `${baseWsUrl}?token=${encodeURIComponent(ticket.token)}`,
      cwd: rootPath,
      expiresInMs: ticket.expiresInMs,
    });
  } catch (error) {
    console.error(error);
    return textResponse(request, "Failed to initialize live terminal", { status: 500 });
  }
}
