import { PassThrough } from "stream";
import { docker } from "@/lib/docker";
import {
  buildOptionsResponse,
  requireApiSession,
  streamResponse,
  textResponse,
} from "@/lib/api-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

function cleanLogChunk(chunk: Buffer) {
  return chunk
    .toString("utf-8")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "");
}

function createDockerLogOutputStream(
  logs: NodeJS.ReadableStream,
  isTty: boolean,
  demuxStream?: (stream: NodeJS.ReadableStream, stdout: NodeJS.WritableStream, stderr: NodeJS.WritableStream) => void
) {
  const output = new PassThrough();

  if (isTty) {
    logs.on("data", (chunk) => {
      output.write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
    });
  } else if (demuxStream) {
    demuxStream(logs, output, output);
  } else {
    let pending = Buffer.alloc(0);
    let mode: "multiplexed" | "raw" | null = null;

    logs.on("data", (chunk) => {
      pending = Buffer.concat([
        pending,
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)),
      ]);

      if (!mode && pending.length >= 8) {
        const streamType = pending[0];
        const hasDockerFrameHeader =
          (streamType === 1 || streamType === 2) &&
          pending[1] === 0 &&
          pending[2] === 0 &&
          pending[3] === 0;

        mode = hasDockerFrameHeader ? "multiplexed" : "raw";
      }

      if (mode === "raw") {
        output.write(pending);
        pending = Buffer.alloc(0);
        return;
      }

      while (pending.length >= 8) {
        const payloadLength = pending.readUInt32BE(4);
        const frameLength = 8 + payloadLength;

        if (pending.length < frameLength) {
          break;
        }

        output.write(pending.subarray(8, frameLength));
        pending = pending.subarray(frameLength);
      }
    });
  }

  logs.on("end", () => output.end());
  logs.on("close", () => output.end());
  logs.on("error", (error) => output.destroy(error));

  return output;
}

function getDockerLogBufferPayload(logs: Buffer, isTty: boolean) {
  if (isTty || logs.length < 8) {
    return logs;
  }

  const streamType = logs[0];
  const hasDockerFrameHeader =
    (streamType === 1 || streamType === 2) &&
    logs[1] === 0 &&
    logs[2] === 0 &&
    logs[3] === 0;

  if (!hasDockerFrameHeader) {
    return logs;
  }

  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset + 8 <= logs.length) {
    const payloadLength = logs.readUInt32BE(offset + 4);
    const frameEnd = offset + 8 + payloadLength;

    if (frameEnd > logs.length) {
      break;
    }

    chunks.push(logs.subarray(offset + 8, frameEnd));
    offset = frameEnd;
  }

  return Buffer.concat(chunks);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD", "USER"],
  });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const { searchParams } = new URL(request.url);
    const containerId = searchParams.get("containerId");
    const tail = searchParams.get("tail") || "100";

    if (!containerId) {
      return textResponse(request, "Container ID required", { status: 400 });
    }

    const container = docker.getContainer(containerId);
    const inspect = await container.inspect();
    const isRunning = inspect.State?.Running ?? false;
    const encoder = new TextEncoder();

    function createSseStream(
      setup: (helpers: {
        send: (event: string, data: unknown) => void;
        close: () => void;
      }) => void
    ) {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          let closed = false;

          function send(event: string, data: unknown) {
            if (closed) return;
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          }

          function close() {
            if (closed) return;
            closed = true;
            clearInterval(keepAlive);
            controller.close();
          }

          const keepAlive = setInterval(() => {
            if (!closed) {
              controller.enqueue(encoder.encode(": keep-alive\n\n"));
            }
          }, 15000);

          controller.enqueue(encoder.encode("retry: 2000\n\n"));
          send("ready", { ok: true, running: isRunning });
          setup({ send, close });
        },
      });
    }

    if (!isRunning) {
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        follow: false,
        tail: parseInt(tail, 10),
        timestamps: true,
      });
      const logString = cleanLogChunk(getDockerLogBufferPayload(logs, inspect.Config?.Tty ?? false));
      const stream = createSseStream(({ send, close }) => {
        if (logString) {
          send("log", { chunk: logString });
        }
        send("end", { running: false });
        close();
      });

      return streamResponse(request, stream, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    }

    const logs = await container.logs({
      stdout: true,
      stderr: true,
      follow: true,
      tail: parseInt(tail, 10),
      timestamps: true,
    });
    const logOutput = createDockerLogOutputStream(
      logs,
      inspect.Config?.Tty ?? false,
      container.modem?.demuxStream?.bind(container.modem)
    );

    const stream = createSseStream(({ send, close }) => {
      logOutput.on("data", (chunk: Buffer) => {
        const logChunk = cleanLogChunk(chunk);
        if (logChunk) {
          send("log", { chunk: logChunk });
        }
      });

      logOutput.on("error", (error) => {
        console.error(error);
        send("log-error", { message: "Docker log stream error" });
        close();
      });

      logOutput.on("end", () => {
        send("end", { running: true });
        close();
      });
      logOutput.on("close", () => {
        send("end", { running: true });
        close();
      });

      request.signal.addEventListener("abort", () => {
        const destroyableLogs = logs as NodeJS.ReadableStream & {
          destroy?: () => void;
        };

        destroyableLogs.destroy?.();
        close();
      });
    });

    return streamResponse(request, stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Docker error", { status: 500 });
  }
}
