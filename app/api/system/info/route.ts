import si from "systeminformation";
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
  const auth = await requireApiSession(request, {
    roles: ["ADMIN", "MOD", "USER"],
  });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const [load, cpuInfo, mem, disk, processes, time] = await Promise.all([
      si.currentLoad(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.processes(),
      si.time(),
    ]);

    const realMemoryUsed = Math.max(0, mem.total - mem.free - mem.buffcache);
    const realMemoryUsedPercent = mem.total > 0 ? (realMemoryUsed / mem.total) * 100 : 0;

    return jsonResponse(request, {
      cpu: {
        usage: load.currentLoad,
        cores: cpuInfo.physicalCores || cpuInfo.cores || 0,
        logicalProcessors: load.cpus?.length || 0,
      },
      memory: {
        total: mem.total,
        used: realMemoryUsed,
        free: mem.free,
        available: mem.available,
        buffCache: mem.buffcache,
        usedPercent: realMemoryUsedPercent,
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
    return textResponse(request, "System error", { status: 500 });
  }
}
