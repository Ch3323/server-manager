import { docker } from "@/lib/docker";
import { recordActivity } from "@/lib/activity";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";
import type Docker from "dockerode";

const fixedContainerUser = "1000";

type KeyValueOption = {
  key: string;
  value: string;
};

type PortOption = {
  containerPort: string;
  hostPort?: string;
  hostIp?: string;
  protocol?: "tcp" | "udp";
};

type VolumeOption = {
  hostPath: string;
  containerPath: string;
  mode?: "rw" | "ro";
};

function getTrimmedString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => getTrimmedString(item)).filter(Boolean);
}

function getKeyValueOptions(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): KeyValueOption | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const key = getTrimmedString(record.key);
      if (!key) return null;
      return {
        key,
        value: typeof record.value === "string" ? record.value : "",
      };
    })
    .filter((item): item is KeyValueOption => item !== null);
}

function getPortOptions(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): PortOption | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const containerPort = getTrimmedString(record.containerPort);
      if (!/^\d+$/.test(containerPort)) return null;

      const protocol = record.protocol === "udp" ? "udp" : "tcp";
      const hostPort = getTrimmedString(record.hostPort);
      const hostIp = getTrimmedString(record.hostIp);

      return { containerPort, hostPort, hostIp, protocol };
    })
    .filter((item): item is PortOption => item !== null);
}

function getVolumeOptions(value: unknown) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item): VolumeOption | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const hostPath = getTrimmedString(record.hostPath);
      const containerPath = getTrimmedString(record.containerPath);
      if (!hostPath || !containerPath) return null;

      return {
        hostPath,
        containerPath,
        mode: record.mode === "ro" ? "ro" : "rw",
      };
    })
    .filter((item): item is VolumeOption => item !== null);
}

function parseCommandLine(value: string) {
  if (!value) return undefined;
  const parts = value.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  return parts?.map((part) => part.replace(/^["']|["']$/g, "")) ?? undefined;
}

function parsePositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function toBytesFromMb(value: unknown) {
  const parsed = parsePositiveNumber(value);
  return parsed ? Math.floor(parsed * 1024 * 1024) : undefined;
}

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN"] });

  if (auth instanceof Response) {
    return auth;
  }

  const { session } = auth;

  try {
    const body = await request.json();
    const imageRef = typeof body?.imageRef === "string" ? body.imageRef.trim() : "";
    const containerName = typeof body?.containerName === "string" ? body.containerName.trim() : "";
    const startAfterCreate = Boolean(body?.startAfterCreate);
    const command = parseCommandLine(getTrimmedString(body?.command));
    const entrypoint = parseCommandLine(getTrimmedString(body?.entrypoint));
    const workingDir = getTrimmedString(body?.workingDir);
    const hostname = getTrimmedString(body?.hostname);
    const restartPolicy = getTrimmedString(body?.restartPolicy);
    const networkMode = getTrimmedString(body?.networkMode);
    const dnsServers = getStringArray(body?.dnsServers);
    const extraHosts = getStringArray(body?.extraHosts);
    const env = getKeyValueOptions(body?.env);
    const labels = getKeyValueOptions(body?.labels);
    const ports = getPortOptions(body?.ports);
    const volumes = getVolumeOptions(body?.volumes);
    const tty = getBoolean(body?.tty, true);
    const openStdin = getBoolean(body?.openStdin, true);
    const privileged = getBoolean(body?.privileged);
    const autoRemove = getBoolean(body?.autoRemove);
    const readonlyRootfs = getBoolean(body?.readonlyRootfs);
    const publishAllPorts = getBoolean(body?.publishAllPorts);
    const memoryBytes = toBytesFromMb(body?.memoryMb);
    const shmSizeBytes = toBytesFromMb(body?.shmSizeMb);
    const cpus = parsePositiveNumber(body?.cpus);

    if (!imageRef) {
      return textResponse(request, "imageRef required", { status: 400 });
    }

    const image = docker.getImage(imageRef);

    try {
      await image.inspect();
    } catch {
      return textResponse(request, `Image not found: ${imageRef}`, { status: 404 });
    }

    await recordActivity({
      actorEmail: session.user.email,
      actorRole: session.user.role,
      action: `requested create container from image ${imageRef}`,
    });

    const exposedPorts: Docker.ContainerCreateOptions["ExposedPorts"] = ports.reduce((acc, port) => {
      acc[`${port.containerPort}/${port.protocol ?? "tcp"}`] = {};
      return acc;
    }, {} as NonNullable<Docker.ContainerCreateOptions["ExposedPorts"]>);
    const portBindings = ports.reduce<Record<string, Array<{ HostIp?: string; HostPort?: string }>>>((acc, port) => {
      const key = `${port.containerPort}/${port.protocol ?? "tcp"}`;
      acc[key] = [
        {
          ...(port.hostIp ? { HostIp: port.hostIp } : {}),
          ...(port.hostPort ? { HostPort: port.hostPort } : {}),
        },
      ];
      return acc;
    }, {});
    const labelMap = labels.reduce<Record<string, string>>((acc, item) => {
      acc[item.key] = item.value;
      return acc;
    }, {});
    const volumeMap: Docker.ContainerCreateOptions["Volumes"] = volumes.reduce((acc, volume) => {
      acc[volume.containerPath] = {};
      return acc;
    }, {} as NonNullable<Docker.ContainerCreateOptions["Volumes"]>);
    const binds = volumes.map((volume) => `${volume.hostPath}:${volume.containerPath}:${volume.mode ?? "rw"}`);
    const hostConfig: Docker.HostConfig = {
      ...(autoRemove ? { AutoRemove: true } : {}),
      ...(binds.length > 0 ? { Binds: binds } : {}),
      ...(networkMode ? { NetworkMode: networkMode } : {}),
      ...(Object.keys(portBindings).length > 0 ? { PortBindings: portBindings } : {}),
      ...(restartPolicy && restartPolicy !== "no" ? { RestartPolicy: { Name: restartPolicy } } : {}),
      ...(dnsServers.length > 0 ? { Dns: dnsServers } : {}),
      ...(extraHosts.length > 0 ? { ExtraHosts: extraHosts } : {}),
      ...(privileged ? { Privileged: true } : {}),
      ...(publishAllPorts ? { PublishAllPorts: true } : {}),
      ...(readonlyRootfs ? { ReadonlyRootfs: true } : {}),
      ...(memoryBytes ? { Memory: memoryBytes } : {}),
      ...(shmSizeBytes ? { ShmSize: shmSizeBytes } : {}),
      ...(cpus ? { NanoCpus: Math.floor(cpus * 1_000_000_000) } : {}),
    };

    const createOptions: Docker.ContainerCreateOptions = {
      Image: imageRef,
      ...(containerName ? { name: containerName } : {}),
      ...(hostname ? { Hostname: hostname } : {}),
      User: fixedContainerUser,
      ...(workingDir ? { WorkingDir: workingDir } : {}),
      ...(command ? { Cmd: command } : {}),
      ...(entrypoint ? { Entrypoint: entrypoint } : {}),
      ...(env.length > 0 ? { Env: env.map((item) => `${item.key}=${item.value}`) } : {}),
      ...(Object.keys(labelMap).length > 0 ? { Labels: labelMap } : {}),
      ...(Object.keys(volumeMap).length > 0 ? { Volumes: volumeMap } : {}),
      ...(Object.keys(exposedPorts).length > 0 ? { ExposedPorts: exposedPorts } : {}),
      Tty: tty,
      OpenStdin: openStdin,
      StdinOnce: false,
      ...(Object.keys(hostConfig).length > 0 ? { HostConfig: hostConfig } : {}),
    };

    const container = await docker.createContainer(createOptions);

    if (startAfterCreate) {
      await container.start();
    }

    const inspect = await container.inspect();
    const createdContainerName = inspect.Name?.replace("/", "") ?? container.id;

    await recordActivity({
      actorEmail: session.user.email,
      actorRole: session.user.role,
      action: startAfterCreate ? "created and started container" : "created container",
      containerName: createdContainerName,
    });

    return jsonResponse(request, {
      success: true,
      id: container.id,
      name: createdContainerName,
      started: startAfterCreate,
    });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Container create error", { status: 500 });
  }
}
