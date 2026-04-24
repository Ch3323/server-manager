import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createTerminalTicket,
  ensureTerminalWsServer,
  getTerminalRootPath,
  resolveWsUrlFromRequest,
} from "@/lib/terminal-ws-server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (session.user.role !== "ADMIN") {
    return new Response("Forbidden - Admin only", { status: 403 });
  }

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

    return Response.json({
      wsUrl: `${baseWsUrl}?token=${encodeURIComponent(ticket.token)}`,
      cwd: rootPath,
      expiresInMs: ticket.expiresInMs,
    });
  } catch (error) {
    console.error(error);
    return new Response("Failed to initialize live terminal", { status: 500 });
  }
}
