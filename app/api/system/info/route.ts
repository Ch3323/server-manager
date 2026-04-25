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

    return jsonResponse(request, {
      cpu: {
        usage: load.currentLoad,
        cores: cpuInfo.physicalCores || cpuInfo.cores || 0,
        logicalProcessors: load.cpus?.length || 0,
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
    return textResponse(request, "System error", { status: 500 });
  }
}
