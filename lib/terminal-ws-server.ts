import { randomUUID } from "node:crypto";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server as HttpServer } from "node:http";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { getTerminalStartPath } from "@/lib/runtime-config";

const WS_PATH = "/ws/terminal";
const WS_PORT = Number(process.env.TERMINAL_WS_PORT ?? "3002");
const WS_HOST = process.env.TERMINAL_WS_HOST ?? "0.0.0.0";
const TICKET_TTL_MS = 45_000;

type Ticket = {
  cwd: string;
  actorEmail: string;
  expiresAt: number;
};

type WsState = {
  isStarted: boolean;
  port: number;
  host: string;
  path: string;
  httpServer: HttpServer | null;
  wss: WebSocketServer | null;
  startPromise: Promise<void> | null;
  tickets: Map<string, Ticket>;
};

const globalForWs = globalThis as typeof globalThis & {
  __terminalWsState?: WsState;
};

function getOrCreateState(): WsState {
  if (!globalForWs.__terminalWsState) {
    globalForWs.__terminalWsState = {
      isStarted: false,
      port: WS_PORT,
      host: WS_HOST,
      path: WS_PATH,
      httpServer: null,
      wss: null,
      startPromise: null,
      tickets: new Map(),
    };
  }
  return globalForWs.__terminalWsState;
}

function getShellConfig() {
  const configuredShell = process.env.TERMINAL_SHELL?.trim();
  if (configuredShell) {
    return {
      shell: configuredShell,
      args: [],
    };
  }

  if (process.platform === "win32") {
    return {
      shell: "powershell.exe",
      args: ["-NoLogo", "-NoProfile"],
    };
  }
  return {
    shell: "/bin/bash",
    args: ["-l"],
  };
}

function send(socket: WebSocket, payload: unknown) {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(payload));
}

function cleanupExpiredTickets(state: WsState) {
  const now = Date.now();
  for (const [token, ticket] of state.tickets) {
    if (ticket.expiresAt <= now) {
      state.tickets.delete(token);
    }
  }
}

function consumeTicket(state: WsState, token: string) {
  cleanupExpiredTickets(state);
  const ticket = state.tickets.get(token);
  if (!ticket) return null;
  state.tickets.delete(token);
  if (ticket.expiresAt <= Date.now()) return null;
  return ticket;
}

function parseWsMessage(raw: RawData) {
  try {
    const parsed = JSON.parse(raw.toString("utf8")) as { type?: unknown; data?: unknown };
    if (typeof parsed.type !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

function parseCdTarget(input: string) {
  const command = input.replace(/\r?\n/g, "").trim();
  const match = command.match(/^cd(?:\s+(.+))?$/i);
  if (!match) return null;
  return (match[1] ?? "").trim();
}

function normalizeCdTarget(rawTarget: string, currentCwd: string) {
  if (rawTarget.length === 0) {
    return os.homedir();
  }

  const unquoted = rawTarget.replace(/^["']|["']$/g, "");

  if (unquoted === "~") return os.homedir();
  if (unquoted.startsWith("~/") || unquoted.startsWith("~\\")) {
    return path.join(os.homedir(), unquoted.slice(2));
  }

  if (path.isAbsolute(unquoted)) {
    return path.resolve(unquoted);
  }

  return path.resolve(currentCwd, unquoted);
}

function bindTerminalSession(socket: WebSocket, ticket: Ticket) {
  const { shell, args } = getShellConfig();
  let currentCwd = ticket.cwd;

  let child: ChildProcessWithoutNullStreams | null = null;

  try {
    child = spawn(shell, args, {
      cwd: currentCwd,
      env: process.env,
      windowsHide: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to spawn shell";
    send(socket, { type: "stderr", data: `${message}\n` });
    socket.close(1011, "spawn failed");
    return;
  }

  send(socket, {
    type: "ready",
    cwd: currentCwd,
    pid: child.pid,
    actorEmail: ticket.actorEmail,
  });

  child.stdout.on("data", (chunk: Buffer) => {
    send(socket, { type: "stdout", data: chunk.toString("utf8") });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    send(socket, { type: "stderr", data: chunk.toString("utf8") });
  });

  child.on("error", (error) => {
    send(socket, { type: "stderr", data: `${error.message}\n` });
  });

  child.on("close", (code, signal) => {
    send(socket, { type: "exit", code, signal });
    if (socket.readyState === socket.OPEN) {
      socket.close(1000, "terminal exited");
    }
  });

  socket.on("message", (raw: RawData) => {
    const parsed = parseWsMessage(raw);
    if (!parsed) return;

    if (parsed.type === "input" && typeof parsed.data === "string") {
      const cdTargetRaw = parseCdTarget(parsed.data);
      if (cdTargetRaw !== null) {
        const nextCwd = normalizeCdTarget(cdTargetRaw, currentCwd);
        void fs
          .stat(nextCwd)
          .then((stat) => {
            if (!stat.isDirectory()) return;
            currentCwd = nextCwd;
            send(socket, { type: "cwd", cwd: currentCwd });
          })
          .catch(() => undefined);
      }

      child?.stdin.write(parsed.data);
      return;
    }

    if (parsed.type === "signal" && typeof parsed.data === "string") {
      const signal = parsed.data.toUpperCase();
      if (signal === "SIGINT") {
        child?.stdin.write("\u0003");
      } else if (signal === "SIGTERM" || signal === "SIGKILL") {
        child?.kill(signal);
      }
      return;
    }

    if (parsed.type === "ping") {
      send(socket, { type: "pong" });
    }
  });

  socket.on("close", () => {
    if (child && !child.killed) {
      child.kill();
    }
    child = null;
  });
}

async function startServer(state: WsState) {
  if (state.isStarted) return;
  if (state.startPromise) {
    await state.startPromise;
    return;
  }

  state.startPromise = new Promise<void>((resolve, reject) => {
    const httpServer = createServer((_req, res) => {
      res.statusCode = 404;
      res.end("Not Found");
    });

    const wss = new WebSocketServer({
      server: httpServer,
      path: state.path,
      maxPayload: 1024 * 1024,
    });

    wss.on("connection", (socket, req) => {
      const base = `http://${req.headers.host ?? "localhost"}`;
      const url = new URL(req.url ?? state.path, base);
      const token = url.searchParams.get("token");

      if (!token) {
        socket.close(1008, "missing token");
        return;
      }

      const ticket = consumeTicket(state, token);
      if (!ticket) {
        socket.close(1008, "invalid ticket");
        return;
      }

      bindTerminalSession(socket, ticket);
    });

    httpServer.listen(state.port, state.host, () => {
      state.httpServer = httpServer;
      state.wss = wss;
      state.isStarted = true;
      state.startPromise = null;
      resolve();
    });

    httpServer.on("error", (error) => {
      state.startPromise = null;
      reject(error);
    });
  });

  await state.startPromise;
}

export function getTerminalRootPath() {
  return getTerminalStartPath();
}

export async function ensureTerminalWsServer() {
  const state = getOrCreateState();
  await startServer(state);
  return {
    host: state.host,
    port: state.port,
    path: state.path,
  };
}

export function createTerminalTicket(payload: { cwd: string; actorEmail: string }) {
  const state = getOrCreateState();
  cleanupExpiredTickets(state);

  const token = randomUUID();
  state.tickets.set(token, {
    cwd: payload.cwd,
    actorEmail: payload.actorEmail,
    expiresAt: Date.now() + TICKET_TTL_MS,
  });

  return {
    token,
    expiresInMs: TICKET_TTL_MS,
  };
}

export function resolveWsUrlFromRequest(options: {
  requestUrl: string;
  wsPort: number;
  wsPath: string;
}) {
  const url = new URL(options.requestUrl);
  const wsProtocol = url.protocol === "https:" ? "wss:" : "ws:";
  return `${wsProtocol}//${url.hostname}:${options.wsPort}${options.wsPath}`;
}
