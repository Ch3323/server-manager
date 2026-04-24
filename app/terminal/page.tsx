"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { Spinner } from "@/components/ui/spinner";

type OutputKind = "command" | "stdout" | "stderr" | "meta";

type OutputBlock = {
  id: string;
  kind: OutputKind;
  text: string;
};

type WsEvent =
  | { type: "ready"; cwd?: string; pid?: number }
  | { type: "cwd"; cwd?: string }
  | { type: "stdout"; data?: string }
  | { type: "stderr"; data?: string }
  | { type: "exit"; code?: number | null; signal?: string | null }
  | { type: "pong" };

type TicketResponse = {
  wsUrl: string;
  cwd: string;
  expiresInMs: number;
};

const MAX_BLOCKS = 2500;

function makeBlock(kind: OutputKind, text: string): OutputBlock {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    kind,
    text,
  };
}

function getControlCharacter(key: string) {
  if (key.length !== 1) return null;

  const upper = key.toUpperCase();
  if (upper >= "A" && upper <= "Z") {
    return String.fromCharCode(upper.charCodeAt(0) - 64);
  }

  if (key === "2" || key === "@") return "\u0000";
  if (key === "6" || key === "^") return "\u001e";
  if (key === "-" || key === "_") return "\u001f";
  return null;
}

function sanitizeTerminalOutput(value: string) {
  const withoutAnsi = value
    // CSI sequences: ESC [ ... command
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    // OSC sequences: ESC ] ... BEL or ESC \
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    // Single-char escape sequences
    .replace(/\u001b[@-_]/g, "");

  return withoutAnsi.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

export default function TerminalPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const wsRef = useRef<WebSocket | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);
  const hasInitializedConnectionRef = useRef(false);

  const [cwd, setCwd] = useState("");
  const [input, setInput] = useState("");
  const [blocks, setBlocks] = useState<OutputBlock[]>([
    makeBlock("meta", "Live terminal ready. Creating secure session..."),
  ]);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  const isAdmin = session?.user?.role === "ADMIN";

  const appendBlock = useCallback((kind: OutputKind, text: string) => {
    if (!text) return;
    setBlocks((prev) => {
      const next = [...prev, makeBlock(kind, text)];
      if (next.length > MAX_BLOCKS) {
        return next.slice(next.length - MAX_BLOCKS);
      }
      return next;
    });
  }, []);

  const closeSocket = useCallback(() => {
    const current = wsRef.current;
    wsRef.current = null;
    if (!current) return;
    try {
      current.close();
    } catch {
      // no-op
    }
  }, []);

  const connectSocket = useCallback(async () => {
    setIsConnecting(true);
    setIsConnected(false);

    closeSocket();

    try {
      const ticketRes = await axios.post<TicketResponse>("/api/terminal/ws-ticket");
      setCwd(ticketRes.data.cwd);

      const ws = new WebSocket(ticketRes.data.wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        appendBlock("meta", `Connected to server terminal (${ticketRes.data.cwd})`);
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data as string) as WsEvent;
          if (payload.type === "ready") {
            if (payload.cwd) setCwd(payload.cwd);
            appendBlock("meta", `Shell started${payload.pid ? ` (pid ${payload.pid})` : ""}`);
            return;
          }

          if (payload.type === "cwd") {
            if (payload.cwd) setCwd(payload.cwd);
            return;
          }

          if (payload.type === "stdout" && payload.data) {
            appendBlock("stdout", sanitizeTerminalOutput(payload.data));
            return;
          }

          if (payload.type === "stderr" && payload.data) {
            appendBlock("stderr", sanitizeTerminalOutput(payload.data));
            return;
          }

          if (payload.type === "exit") {
            appendBlock(
              "meta",
              `Shell exited (code: ${payload.code ?? "unknown"}${payload.signal ? `, signal: ${payload.signal}` : ""})`
            );
          }
        } catch {
          appendBlock("stderr", "Failed to parse server message");
        }
      };

      ws.onerror = () => {
        appendBlock("stderr", "WebSocket connection error");
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        if (wsRef.current === ws) {
          wsRef.current = null;
        }
        appendBlock("meta", "Disconnected from server terminal");
      };
    } catch (err) {
      console.error(err);
      appendBlock("stderr", "Failed to establish live terminal session");
      setIsConnecting(false);
      setIsConnected(false);
    }
  }, [appendBlock, closeSocket]);

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
    if (hasInitializedConnectionRef.current) return;
    hasInitializedConnectionRef.current = true;

    void connectSocket();
  }, [connectSocket, isAdmin, router, status]);

  useEffect(() => {
    if (!outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [blocks, isConnected, isConnecting]);

  function sendRawInput(raw: string) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "input", data: raw }));
  }

  function sendSignal(signal: "SIGINT" | "SIGTERM" | "SIGKILL") {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: "signal", data: signal }));
  }

  function submitInput() {
    const command = input.trim();
    if (!command) return;
    const normalized = command.toLowerCase();
    if (normalized === "clear" || normalized === "cls") {
      setBlocks([]);
      setInput("");
      return;
    }
    if (normalized === "reconnect") {
      void connectSocket();
      setInput("");
      return;
    }
    if (!isConnected) {
      appendBlock("stderr", "Terminal is disconnected. Type 'reconnect' and press Enter.");
      return;
    }
    appendBlock("command", `${cwd || "."}> ${command}\n`);
    sendRawInput(`${command}\n`);
    setInput("");
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const usesControlModifier = (event.ctrlKey || event.metaKey) && !event.altKey;
    if (usesControlModifier) {
      const controlChar = getControlCharacter(event.key);
      if (controlChar) {
        event.preventDefault();

        if (!isConnected) {
          appendBlock("stderr", "Terminal is disconnected. Type 'reconnect' and press Enter.");
          return;
        }

        const normalizedKey = event.key.toLowerCase();
        if (normalizedKey === "c") {
          sendSignal("SIGINT");
          appendBlock("meta", "^C");
          return;
        } else if (normalizedKey === "d") {
          appendBlock("meta", "^D");
        } else if (normalizedKey === "z") {
          appendBlock("meta", "^Z");
        }

        sendRawInput(controlChar);
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      submitInput();
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Spinner className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading terminal...</p>
        </div>
      </div>
    );
  }

  if (!session || !isAdmin) return null;

  return (
    <div className="p-0">
      <div className="h-[calc(100vh-4rem)] overflow-hidden border bg-black font-mono text-xs leading-5 md:text-sm">
        <div ref={outputRef} className="h-[calc(100%-44px)] overflow-auto p-3">
          <div className="space-y-1 whitespace-pre-wrap wrap-break-word">
            {blocks.map((block) => (
              <p
                key={block.id}
                className={
                  block.kind === "command"
                    ? "text-cyan-300"
                    : block.kind === "stderr"
                      ? "text-red-300"
                      : block.kind === "meta"
                        ? "text-zinc-400"
                        : "text-zinc-100"
                }
              >
                {block.text}
              </p>
            ))}
          </div>
        </div>

        <div className="flex h-11 items-center gap-2 border-t border-zinc-800 px-3 text-zinc-100">
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder={isConnecting ? "Connecting..." : isConnected ? "Type command..." : "Disconnected"}
            className="w-full bg-transparent outline-none placeholder:text-zinc-500"
            disabled={isConnecting}
          />
          {isConnecting ? <Spinner className="h-4 w-4 text-zinc-400" /> : null}
        </div>
      </div>
    </div>
  );
}
