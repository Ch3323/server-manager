import { existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import nextEnv from "@next/env";
import next from "next";
import { getToken } from "next-auth/jwt";
import { decode } from "next-auth/jwt";
import pty from "node-pty";
import { Server as SocketIOServer } from "socket.io";

const projectDir = process.cwd();
const dev = process.env.NODE_ENV !== "production";
const { loadEnvConfig } = nextEnv;
loadEnvConfig(projectDir, dev);

const hostname = process.env.HOSTNAME || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const socketPath = process.env.TERMINAL_SOCKET_PATH || "/socket.io";

const app = next({ dev, dir: projectDir, hostname, port });
const handle = app.getRequestHandler();

function resolveFromCwd(inputPath) {
  return path.resolve(process.cwd(), inputPath);
}

function getWorkspaceRoot() {
  const configuredRoot = process.env.FILE_MANAGER_ROOT?.trim();
  return configuredRoot ? resolveFromCwd(configuredRoot) : process.cwd();
}

function getTerminalStartPath() {
  const configuredPath = process.env.TERMINAL_ROOT_PATH?.trim();
  return configuredPath ? resolveFromCwd(configuredPath) : getWorkspaceRoot();
}

function getShellConfig() {
  const configuredShell = process.env.TERMINAL_SHELL?.trim();
  if (configuredShell) {
    return { shell: configuredShell, args: [] };
  }

  if (process.platform === "win32") {
    return { shell: "powershell.exe", args: ["-NoLogo", "-NoProfile"] };
  }

  return { shell: process.env.SHELL || "/bin/bash", args: ["-l"] };
}

function normalizeOrigin(value) {
  return value?.trim().replace(/\/+$/, "");
}

function getAllowedOrigins(requestHost) {
  const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => normalizeOrigin(origin))
    .filter(Boolean);

  return new Set(
    [
      normalizeOrigin(process.env.NEXTAUTH_URL),
      requestHost ? `http://${requestHost}` : null,
      requestHost ? `https://${requestHost}` : null,
      ...configuredOrigins,
    ].filter(Boolean)
  );
}

function isAllowedOrigin(socket) {
  const origin = normalizeOrigin(socket.handshake.headers.origin);
  if (!origin) return true;
  return getAllowedOrigins(socket.handshake.headers.host).has(origin);
}

function resolveStartPath() {
  const preferredPath = getTerminalStartPath();
  try {
    if (statSync(preferredPath).isDirectory()) return preferredPath;
  } catch {
    // Fall through to safer defaults.
  }

  const workspaceRoot = getWorkspaceRoot();
  try {
    if (statSync(workspaceRoot).isDirectory()) return workspaceRoot;
  } catch {
    // Fall through to home.
  }

  return existsSync(os.homedir()) ? os.homedir() : process.cwd();
}

function bindTerminalSession(socket) {
  const { shell, args } = getShellConfig();
  const cwd = resolveStartPath();
  const env = {
    ...process.env,
    TERM: process.env.TERM || "xterm-256color",
    COLORTERM: process.env.COLORTERM || "truecolor",
  };

  let term;
  try {
    term = pty.spawn(shell, args, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd,
      env,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to spawn shell";
    socket.emit("terminal:error", { message });
    socket.disconnect(true);
    return;
  }

  socket.emit("terminal:ready", {
    cwd,
    pid: term.pid,
    actorEmail: socket.data.user?.email,
  });

  term.onData((data) => {
    socket.emit("terminal:output", data);
  });

  term.onExit(({ exitCode, signal }) => {
    socket.emit("terminal:exit", { code: exitCode, signal });
    socket.disconnect(true);
  });

  socket.on("terminal:input", (data) => {
    if (typeof data === "string") {
      term.write(data);
    }
  });

  socket.on("terminal:resize", (size) => {
    const cols = Number(size?.cols);
    const rows = Number(size?.rows);
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && rows > 0) {
      term.resize(cols, rows);
    }
  });

  socket.on("terminal:signal", (signal) => {
    if (typeof signal !== "string") return;
    if (signal.toUpperCase() === "SIGINT") {
      term.write("\u0003");
    }
  });

  socket.on("disconnect", () => {
    try {
      term.kill();
    } catch {
      // Session already ended.
    }
  });
}

async function getSocketToken(socket) {
  const cookies = socket.request.headers.cookie;
  
  // Try to extract session token from cookies
  const cookieList = cookies?.split(';').map(c => c.trim()) || [];
  let sessionToken = null;
  
  for (const cookie of cookieList) {
    if (cookie.startsWith('__Secure-next-auth.session-token=')) {
      sessionToken = cookie.replace('__Secure-next-auth.session-token=', '');
      break;
    }
    if (cookie.startsWith('next-auth.session-token=')) {
      sessionToken = cookie.replace('next-auth.session-token=', '');
      break;
    }
  }
  
  // Try decode directly
  if (sessionToken) {
    try {
      const decoded = await decode({ token: sessionToken, secret: process.env.NEXTAUTH_SECRET });
      if (decoded && decoded.sub) {
        return decoded;
      }
    } catch (e) {
      console.error("> Decode error:", e);
    }
  }
  
  // Fallback to getToken
  const tokenOptions = {
    req: socket.request,
    secret: process.env.NEXTAUTH_SECRET,
    url: process.env.NEXTAUTH_URL || "https://server.ittipat.site",
  };
  
  try {
    const token1 = await getToken({ ...tokenOptions, secureCookie: true });
    const token2 = await getToken({ ...tokenOptions, secureCookie: false });
    
    return token1 || token2;
  } catch (error) {
    console.error("> getToken error:", error);
    return null;
  }
}

await app.prepare();

const httpServer = createServer((req, res) => {
  handle(req, res);
});

const io = new SocketIOServer(httpServer, {
  path: socketPath,
  maxHttpBufferSize: 1024 * 1024,
});

io.use(async (socket, nextMiddleware) => {
  if (!isAllowedOrigin(socket)) {
    nextMiddleware(new Error("origin not allowed"));
    return;
  }

  try {
    const token = await getSocketToken(socket);

    if (!token || token.role !== "ADMIN") {
      console.warn("Terminal socket rejected", {
        reason: token ? "role not allowed" : "missing token",
        role: token?.role,
        hasSubject: Boolean(token?.sub),
        origin: socket.handshake.headers.origin,
      });
      nextMiddleware(new Error("unauthorized"));
      return;
    }

    socket.data.user = {
      email: typeof token.email === "string" ? token.email : undefined,
      role: token.role,
    };
    nextMiddleware();
  } catch (error) {
    nextMiddleware(error instanceof Error ? error : new Error("authentication failed"));
  }
});

io.on("connection", (socket) => {
  bindTerminalSession(socket);
});

function shutdown(signal) {
  console.log(`> Received ${signal}, shutting down...`);

  io.close(() => {
    httpServer.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
        console.error(error);
        process.exit(1);
      }

      process.exit(0);
    });
  });

  setTimeout(() => {
    console.error("> Forced shutdown after timeout");
    process.exit(1);
  }, 5000).unref();
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

httpServer.listen(port, hostname, () => {
  console.log(`> Server listening at http://${hostname}:${port}`);
  console.log(`> Terminal Socket.IO path ${socketPath}`);
});
