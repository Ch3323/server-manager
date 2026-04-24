import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import si from "systeminformation";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const [cpu, mem, disk, processes, time] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.processes(),
      si.time(),
    ]);

    return Response.json({
      cpu: {
        usage: cpu.currentLoad,
        cores: cpu.cpus?.length || 0,
      },
      memory: {
        total: mem.total,
        used: mem.used,
        free: mem.free,
        usedPercent: (mem.used / mem.total) * 100,
      },
      disk: disk.map((d) => ({
        mount: d.mount,
        size: d.size,
        used: d.used,
        available: d.available,
        usedPercent: d.use,
      })),
      processes: {
        all: processes.all,
        running: processes.running,
        blocked: processes.blocked,
        sleeping: processes.sleeping,
        list: processes.list.slice(0, 10).map((p) => ({
          pid: p.pid,
          name: p.name,
          cpu: p.cpu,
          mem: p.mem,
          state: p.state,
        })),
      },
      uptime: time.uptime,
    });
  } catch (err) {
    console.error(err);
    return new Response("System error", { status: 500 });
  }
}
