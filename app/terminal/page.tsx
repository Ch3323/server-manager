"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCcw, TerminalIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import type { Socket } from "socket.io-client";
import { showErrorToast, showInfoToast, showSuccessToast } from "@/lib/client-notify";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type TerminalCtor = typeof import("@xterm/xterm").Terminal;
type TerminalInstance = import("@xterm/xterm").Terminal;
type FitAddonInstance = import("@xterm/addon-fit").FitAddon;

type TerminalReadyEvent = {
  cwd?: string;
  pid?: number;
  actorEmail?: string;
};

type TerminalExitEvent = {
  code?: number | null;
  signal?: string | null;
};

function sendResize(socket: Socket | null, terminal: TerminalInstance | null) {
  if (!socket?.connected || !terminal) return;
  socket.emit("terminal:resize", {
    cols: terminal.cols,
    rows: terminal.rows,
  });
}

export default function TerminalPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<TerminalInstance | null>(null);
  const fitAddonRef = useRef<FitAddonInstance | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const hasInitializedTerminalRef = useRef(false);
  const hasInitializedConnectionRef = useRef(false);

  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [statusText, setStatusText] = useState("Preparing terminal");
  const [isTerminalReady, setIsTerminalReady] = useState(false);

  const isAdmin = session?.user?.role === "ADMIN";

  const closeSocket = useCallback(() => {
    const current = socketRef.current;
    socketRef.current = null;
    if (!current) return;
    current.removeAllListeners();
    current.disconnect();
  }, []);

  const fitTerminal = useCallback(() => {
    try {
      fitAddonRef.current?.fit();
      sendResize(socketRef.current, terminalRef.current);
    } catch {
      // The terminal can briefly be detached during route transitions.
    }
  }, []);

  const connectSocket = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    setIsConnecting(true);
    setIsConnected(false);
    setStatusText("Connecting");
    closeSocket();

    terminal.reset();
    terminal.writeln("Connecting to host terminal...");

    try {
      const { io } = await import("socket.io-client");
      const socket = io({
        path: process.env.NEXT_PUBLIC_TERMINAL_SOCKET_PATH || "/socket.io",
        transports: ["websocket"],
        withCredentials: true,
        reconnection: false,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        setIsConnected(true);
        setIsConnecting(false);
        setStatusText("Connected");
        showSuccessToast("Connected to host terminal");
        terminal.focus();
        fitTerminal();
      });

      socket.on("terminal:ready", (payload: TerminalReadyEvent) => {
        terminal.writeln(
          `\x1b[90mConnected to host shell${payload.pid ? ` (pid ${payload.pid})` : ""}\x1b[0m`
        );
        sendResize(socket, terminal);
      });

      socket.on("terminal:output", (data: unknown) => {
        if (typeof data === "string") {
          terminal.write(data);
        }
      });

      socket.on("terminal:error", (payload: { message?: string }) => {
        const message = payload.message || "Terminal error";
        terminal.writeln(`\r\n\x1b[31m${message}\x1b[0m`);
        showErrorToast(new Error(message), message);
      });

      socket.on("terminal:exit", (payload: TerminalExitEvent) => {
        terminal.writeln(
          `\r\n\x1b[90mShell exited (code: ${payload.code ?? "unknown"}${
            payload.signal ? `, signal: ${payload.signal}` : ""
          })\x1b[0m`
        );
      });

      socket.on("connect_error", (error) => {
        terminal.writeln(`\r\n\x1b[31mSocket.IO connection error: ${error.message}\x1b[0m`);
        setStatusText("Connection failed");
        setIsConnecting(false);
        setIsConnected(false);
        showErrorToast(error, "Socket.IO connection error");
      });

      socket.on("disconnect", () => {
        setIsConnected(false);
        setIsConnecting(false);
        setStatusText("Disconnected");
        if (socketRef.current === socket) {
          socketRef.current = null;
        }
        terminal.writeln("\r\n\x1b[90mDisconnected from host terminal\x1b[0m");
        showInfoToast("Disconnected from host terminal");
      });
    } catch (error) {
      console.error(error);
      terminal.writeln("\r\n\x1b[31mFailed to establish host terminal session\x1b[0m");
      setStatusText("Connection failed");
      setIsConnecting(false);
      setIsConnected(false);
      showErrorToast(error, "Failed to establish host terminal session");
    }
  }, [closeSocket, fitTerminal]);

  useEffect(() => {
    if (status !== "authenticated" || !isAdmin) return;
    if (hasInitializedTerminalRef.current || !terminalHostRef.current) return;
    hasInitializedTerminalRef.current = true;

    let resizeObserver: ResizeObserver | null = null;
    let disposed = false;

    void Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ]).then(([xtermModule, fitModule]) => {
      if (disposed || !terminalHostRef.current) return;

      const Terminal = xtermModule.Terminal as TerminalCtor;
      const { FitAddon } = fitModule;
      const terminal = new Terminal({
        cursorBlink: true,
        convertEol: false,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 1.2,
        scrollback: 8000,
        theme: {
          background: "#050505",
          foreground: "#f4f4f5",
          cursor: "#fafafa",
          selectionBackground: "#334155",
        },
      });
      const fitAddon = new FitAddon();

      terminal.loadAddon(fitAddon);
      terminal.open(terminalHostRef.current);
      terminalRef.current = terminal;
      fitAddonRef.current = fitAddon;
      setIsTerminalReady(true);

      terminal.onData((data) => {
        const socket = socketRef.current;
        if (socket?.connected) {
          socket.emit("terminal:input", data);
        }
      });

      resizeObserver = new ResizeObserver(() => fitTerminal());
      resizeObserver.observe(terminalHostRef.current);
      fitTerminal();
      terminal.focus();
    });

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      setIsTerminalReady(false);
    };
  }, [fitTerminal, isAdmin, status]);

  useEffect(() => {
    return () => {
      closeSocket();
    };
  }, [closeSocket]);

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") {
      router.push("/auth/login");
      return;
    }
    if (!isAdmin) {
      router.push("/dashboard");
      return;
    }
    if (hasInitializedConnectionRef.current || !isTerminalReady) return;
    hasInitializedConnectionRef.current = true;

    void connectSocket();
  }, [connectSocket, isAdmin, isTerminalReady, router, status]);

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Spinner className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">Loading terminal...</p>
        </div>
      </div>
    );
  }

  if (!session || !isAdmin) return null;

  return (
    <div className="h-[calc(100vh-4rem)] overflow-hidden bg-black">
      <div className="flex h-11 items-center justify-between border-b border-zinc-800 bg-zinc-950 px-3 text-zinc-100">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalIcon className="size-4 shrink-0 text-emerald-400" />
          <span className="truncate text-sm font-medium">Host terminal</span>
          <span className="text-xs text-zinc-500">{statusText}</span>
        </div>
        <div className="flex items-center gap-2">
          {isConnecting ? <Spinner className="h-4 w-4 text-zinc-400" /> : null}
          <span
            className={
              isConnected
                ? "size-2 rounded-full bg-emerald-400"
                : isConnecting
                  ? "size-2 rounded-full bg-amber-400"
                  : "size-2 rounded-full bg-zinc-600"
            }
            aria-label={isConnected ? "Connected" : isConnecting ? "Connecting" : "Disconnected"}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-zinc-200 hover:bg-zinc-800 hover:text-white"
            onClick={() => void connectSocket()}
            disabled={isConnecting}
            title="Reconnect"
          >
            <RefreshCcw className="size-4" />
          </Button>
        </div>
      </div>
      <div ref={terminalHostRef} className="h-[calc(100%-44px)] w-full p-2" />
    </div>
  );
}
