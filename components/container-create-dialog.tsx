"use client";

import { useMemo, useState } from "react";
import axios from "axios";
import { FolderOpen, Plus, RefreshCw, Trash2 } from "lucide-react";

import { showErrorToast, showSuccessToast } from "@/lib/client-notify";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

type ImageOption = {
  id: string;
  primaryTag: string;
  isDangling: boolean;
};

type KeyValueRow = {
  id: string;
  key: string;
  value: string;
};

type PortRow = {
  id: string;
  containerPort: string;
  hostPort: string;
  hostIp: string;
  protocol: "tcp" | "udp";
};

type VolumeRow = {
  id: string;
  hostPath: string;
  containerPath: string;
  mode: "rw" | "ro";
};

type FileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
};

type FolderBrowserState = {
  volumeRowId: string;
  rootName: string;
  currentPath: string;
  currentAbsolutePath: string;
  currentHostPath: string;
  entries: FileEntry[];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  imageOptions: ImageOption[];
  onCreated: () => Promise<void> | void;
};

const restartPolicies = ["no", "always", "unless-stopped", "on-failure"] as const;
const fixedContainerUser = "1000";

function createId() {
  return crypto.randomUUID();
}

function emptyKeyValueRow(): KeyValueRow {
  return { id: createId(), key: "", value: "" };
}

function emptyPortRow(): PortRow {
  return { id: createId(), containerPort: "", hostPort: "", hostIp: "", protocol: "tcp" };
}

function emptyVolumeRow(): VolumeRow {
  return { id: createId(), hostPath: "", containerPath: "", mode: "rw" };
}

function splitLines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ContainerCreateDialog({ open, onOpenChange, imageOptions, onCreated }: Props) {
  const [imageRef, setImageRef] = useState("");
  const [containerName, setContainerName] = useState("");
  const [startAfterCreate, setStartAfterCreate] = useState(true);
  const [isCreating, setIsCreating] = useState(false);

  const [command, setCommand] = useState("");
  const [entrypoint, setEntrypoint] = useState("");
  const [workingDir, setWorkingDir] = useState("");
  const [hostname, setHostname] = useState("");
  const [restartPolicy, setRestartPolicy] = useState<(typeof restartPolicies)[number]>("no");
  const [networkMode, setNetworkMode] = useState("");
  const [dnsServers, setDnsServers] = useState("");
  const [extraHosts, setExtraHosts] = useState("");
  const [envRows, setEnvRows] = useState<KeyValueRow[]>([emptyKeyValueRow()]);
  const [labelRows, setLabelRows] = useState<KeyValueRow[]>([emptyKeyValueRow()]);
  const [portRows, setPortRows] = useState<PortRow[]>([emptyPortRow()]);
  const [volumeRows, setVolumeRows] = useState<VolumeRow[]>([emptyVolumeRow()]);

  const [tty, setTty] = useState(true);
  const [openStdin, setOpenStdin] = useState(true);
  const [privileged, setPrivileged] = useState(false);
  const [autoRemove, setAutoRemove] = useState(false);
  const [readonlyRootfs, setReadonlyRootfs] = useState(false);
  const [publishAllPorts, setPublishAllPorts] = useState(false);
  const [memoryMb, setMemoryMb] = useState("");
  const [cpus, setCpus] = useState("");
  const [shmSizeMb, setShmSizeMb] = useState("");
  const [folderBrowser, setFolderBrowser] = useState<FolderBrowserState | null>(null);
  const [isFolderBrowserLoading, setIsFolderBrowserLoading] = useState(false);

  const hasImages = imageOptions.length > 0;
  const selectedImageRef = imageRef || imageOptions[0]?.primaryTag || "";
  const filledEnvRows = useMemo(() => envRows.filter((row) => row.key.trim()), [envRows]);
  const filledLabelRows = useMemo(() => labelRows.filter((row) => row.key.trim()), [labelRows]);
  const filledPortRows = useMemo(() => portRows.filter((row) => row.containerPort.trim()), [portRows]);
  const filledVolumeRows = useMemo(
    () => volumeRows.filter((row) => row.hostPath.trim() && row.containerPath.trim()),
    [volumeRows]
  );

  function resetForm() {
    setContainerName("");
    setStartAfterCreate(true);
    setCommand("");
    setEntrypoint("");
    setWorkingDir("");
    setHostname("");
    setRestartPolicy("no");
    setNetworkMode("");
    setDnsServers("");
    setExtraHosts("");
    setEnvRows([emptyKeyValueRow()]);
    setLabelRows([emptyKeyValueRow()]);
    setPortRows([emptyPortRow()]);
    setVolumeRows([emptyVolumeRow()]);
    setTty(true);
    setOpenStdin(true);
    setPrivileged(false);
    setAutoRemove(false);
    setReadonlyRootfs(false);
    setPublishAllPorts(false);
    setMemoryMb("");
    setCpus("");
    setShmSizeMb("");
  }

  async function createContainer() {
    if (!selectedImageRef) return;

    setIsCreating(true);

    try {
      const res = await axios.post("/api/containers/create", {
        imageRef: selectedImageRef,
        containerName: containerName.trim(),
        startAfterCreate,
        command: command.trim(),
        entrypoint: entrypoint.trim(),
        workingDir: workingDir.trim(),
        user: fixedContainerUser,
        hostname: hostname.trim(),
        restartPolicy,
        networkMode: networkMode.trim(),
        dnsServers: splitLines(dnsServers),
        extraHosts: splitLines(extraHosts),
        env: filledEnvRows.map(({ key, value }) => ({ key: key.trim(), value })),
        labels: filledLabelRows.map(({ key, value }) => ({ key: key.trim(), value })),
        ports: filledPortRows.map(({ containerPort, hostPort, hostIp, protocol }) => ({
          containerPort: containerPort.trim(),
          hostPort: hostPort.trim(),
          hostIp: hostIp.trim(),
          protocol,
        })),
        volumes: filledVolumeRows.map(({ hostPath, containerPath, mode }) => ({
          hostPath: hostPath.trim(),
          containerPath: containerPath.trim(),
          mode,
        })),
        tty,
        openStdin,
        privileged,
        autoRemove,
        readonlyRootfs,
        publishAllPorts,
        memoryMb: memoryMb.trim(),
        cpus: cpus.trim(),
        shmSizeMb: shmSizeMb.trim(),
      });

      const createdName = res.data?.name ?? "container";
      const message = `Created ${createdName}${startAfterCreate ? " and started it" : ""}`;
      showSuccessToast(message);
      onOpenChange(false);
      resetForm();
      await onCreated();
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to create container");
    } finally {
      setIsCreating(false);
    }
  }

  function updateRow<T extends { id: string }>(
    rows: T[],
    setRows: (rows: T[]) => void,
    id: string,
    patch: Partial<T>
  ) {
    setRows(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  function removeRow<T extends { id: string }>(rows: T[], setRows: (rows: T[]) => void, id: string, fallback: T) {
    const nextRows = rows.filter((row) => row.id !== id);
    setRows(nextRows.length > 0 ? nextRows : [fallback]);
  }

  async function loadFolderBrowserPath(volumeRowId: string, path: string) {
    setIsFolderBrowserLoading(true);

    try {
      const res = await axios.get("/api/files/list", {
        params: { path },
      });

      setFolderBrowser({
        volumeRowId,
        rootName: res.data.rootName ?? "workspace",
        currentPath: res.data.currentPath ?? "",
        currentAbsolutePath: res.data.currentAbsolutePath ?? "",
        currentHostPath: res.data.currentHostPath ?? res.data.currentAbsolutePath ?? "",
        entries: (res.data.entries ?? []) as FileEntry[],
      });
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to browse folders");
    } finally {
      setIsFolderBrowserLoading(false);
    }
  }

  function openFolderBrowser(volumeRowId: string) {
    const row = volumeRows.find((item) => item.id === volumeRowId);
    void loadFolderBrowserPath(volumeRowId, row?.containerPath ? "" : "");
  }

  function useSelectedFolder() {
    if (!folderBrowser?.currentHostPath) return;

    updateRow(volumeRows, setVolumeRows, folderBrowser.volumeRowId, {
      hostPath: folderBrowser.currentHostPath,
    });
    setFolderBrowser(null);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-5xl max-h-[90vh] overflow-y-auto" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Create Container</DialogTitle>
            <DialogDescription>
              Configure image, runtime, ports, volumes, identity, resources, and metadata.
            </DialogDescription>
          </DialogHeader>

        <div className="space-y-6">
          <section className="space-y-3">
            <div className="grid gap-3 lg:grid-cols-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">Image</p>
                <Select value={selectedImageRef} onValueChange={setImageRef} disabled={!hasImages}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select image" />
                  </SelectTrigger>
                  <SelectContent>
                    {imageOptions.map((img) => (
                      <SelectItem key={img.id} value={img.primaryTag}>
                        {img.primaryTag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Container Name</p>
                <Input
                  value={containerName}
                  onChange={(event) => setContainerName(event.target.value)}
                  placeholder="my-app-container"
                />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">Hostname</p>
                <Input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="app-01" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">User</p>
                <Input value={fixedContainerUser} disabled />
              </div>
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-sm font-semibold">Command</p>
            <div className="grid gap-3 lg:grid-cols-3">
              <Input value={entrypoint} onChange={(event) => setEntrypoint(event.target.value)} placeholder="Entrypoint" />
              <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Command" />
              <Input value={workingDir} onChange={(event) => setWorkingDir(event.target.value)} placeholder="/workdir" />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Environment</p>
              <Button variant="outline" size="sm" onClick={() => setEnvRows([...envRows, emptyKeyValueRow()])}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {envRows.map((row) => (
                <div key={row.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]">
                  <Input value={row.key} onChange={(event) => updateRow(envRows, setEnvRows, row.id, { key: event.target.value })} placeholder="KEY" />
                  <Input value={row.value} onChange={(event) => updateRow(envRows, setEnvRows, row.id, { value: event.target.value })} placeholder="value" />
                  <Button variant="ghost" size="icon-sm" onClick={() => removeRow(envRows, setEnvRows, row.id, emptyKeyValueRow())}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Ports</p>
              <Button variant="outline" size="sm" onClick={() => setPortRows([...portRows, emptyPortRow()])}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {portRows.map((row) => (
                <div key={row.id} className="grid gap-2 lg:grid-cols-[1fr_1fr_1fr_110px_36px]">
                  <Input value={row.containerPort} onChange={(event) => updateRow(portRows, setPortRows, row.id, { containerPort: event.target.value })} placeholder="Container port" />
                  <Input value={row.hostPort} onChange={(event) => updateRow(portRows, setPortRows, row.id, { hostPort: event.target.value })} placeholder="Host port" />
                  <Input value={row.hostIp} onChange={(event) => updateRow(portRows, setPortRows, row.id, { hostIp: event.target.value })} placeholder="Host IP" />
                  <Select value={row.protocol} onValueChange={(value) => updateRow(portRows, setPortRows, row.id, { protocol: value as "tcp" | "udp" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tcp">TCP</SelectItem>
                      <SelectItem value="udp">UDP</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" onClick={() => removeRow(portRows, setPortRows, row.id, emptyPortRow())}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Volumes</p>
              <Button variant="outline" size="sm" onClick={() => setVolumeRows([...volumeRows, emptyVolumeRow()])}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {volumeRows.map((row) => (
                <div key={row.id} className="grid gap-2 lg:grid-cols-[1fr_40px_1fr_110px_36px]">
                  <Input value={row.hostPath} onChange={(event) => updateRow(volumeRows, setVolumeRows, row.id, { hostPath: event.target.value })} placeholder="/host/path" />
                  <Button variant="outline" size="icon-sm" onClick={() => openFolderBrowser(row.id)}>
                    <FolderOpen className="h-4 w-4" />
                    <span className="sr-only">Browse host folder</span>
                  </Button>
                  <Input value={row.containerPath} onChange={(event) => updateRow(volumeRows, setVolumeRows, row.id, { containerPath: event.target.value })} placeholder="/container/path" />
                  <Select value={row.mode} onValueChange={(value) => updateRow(volumeRows, setVolumeRows, row.id, { mode: value as "rw" | "ro" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rw">RW</SelectItem>
                      <SelectItem value="ro">RO</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="icon-sm" onClick={() => removeRow(volumeRows, setVolumeRows, row.id, emptyVolumeRow())}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-sm font-semibold">Network & Restart</p>
            <div className="grid gap-3 lg:grid-cols-3">
              <Select value={restartPolicy} onValueChange={(value) => setRestartPolicy(value as (typeof restartPolicies)[number])}>
                <SelectTrigger><SelectValue placeholder="Restart policy" /></SelectTrigger>
                <SelectContent>
                  {restartPolicies.map((policy) => <SelectItem key={policy} value={policy}>{policy}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input value={networkMode} onChange={(event) => setNetworkMode(event.target.value)} placeholder="bridge, host, none, network name" />
              <Input value={cpus} onChange={(event) => setCpus(event.target.value)} placeholder="CPUs e.g. 0.5, 2" />
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              <textarea className="min-h-20 rounded-md border bg-transparent px-3 py-2 text-sm" value={dnsServers} onChange={(event) => setDnsServers(event.target.value)} placeholder={"DNS servers, one per line\n1.1.1.1"} />
              <textarea className="min-h-20 rounded-md border bg-transparent px-3 py-2 text-sm" value={extraHosts} onChange={(event) => setExtraHosts(event.target.value)} placeholder={"Extra hosts, one per line\nhost.docker.internal:host-gateway"} />
            </div>
          </section>

          <section className="space-y-3">
            <p className="text-sm font-semibold">Resources & Runtime</p>
            <div className="grid gap-3 lg:grid-cols-3">
              <Input value={memoryMb} onChange={(event) => setMemoryMb(event.target.value)} placeholder="Memory MB" />
              <Input value={shmSizeMb} onChange={(event) => setShmSizeMb(event.target.value)} placeholder="SHM size MB" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["Start after create", startAfterCreate, setStartAfterCreate],
                ["TTY", tty, setTty],
                ["Open STDIN", openStdin, setOpenStdin],
                ["Privileged", privileged, setPrivileged],
                ["Auto remove", autoRemove, setAutoRemove],
                ["Readonly rootfs", readonlyRootfs, setReadonlyRootfs],
                ["Publish all ports", publishAllPorts, setPublishAllPorts],
              ].map(([label, checked, setter]) => (
                <label key={label as string} className="flex items-center gap-2 text-sm">
                  <Checkbox checked={checked as boolean} onCheckedChange={(value) => (setter as (next: boolean) => void)(value === true)} />
                  {label as string}
                </label>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Labels</p>
              <Button variant="outline" size="sm" onClick={() => setLabelRows([...labelRows, emptyKeyValueRow()])}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            <div className="space-y-2">
              {labelRows.map((row) => (
                <div key={row.id} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_36px]">
                  <Input value={row.key} onChange={(event) => updateRow(labelRows, setLabelRows, row.id, { key: event.target.value })} placeholder="label.key" />
                  <Input value={row.value} onChange={(event) => updateRow(labelRows, setLabelRows, row.id, { value: event.target.value })} placeholder="value" />
                  <Button variant="ghost" size="icon-sm" onClick={() => removeRow(labelRows, setLabelRows, row.id, emptyKeyValueRow())}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isCreating}>
            Cancel
          </Button>
          <Button onClick={() => void createContainer()} disabled={isCreating || !selectedImageRef}>
            {isCreating ? <Spinner className="h-4 w-4" /> : null}
            Create
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={folderBrowser !== null} onOpenChange={(nextOpen) => !nextOpen && setFolderBrowser(null)}>
        <DialogContent className="sm:max-w-3xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Browse Folder</DialogTitle>
            <DialogDescription className="break-all">
              {folderBrowser?.currentHostPath || "Loading folders..."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => folderBrowser && void loadFolderBrowserPath(folderBrowser.volumeRowId, "")}
                disabled={isFolderBrowserLoading}
              >
                {folderBrowser?.rootName ?? "Root"}
              </Button>
              {folderBrowser?.currentPath.split("/").filter(Boolean).map((segment, index, parts) => {
                const nextPath = parts.slice(0, index + 1).join("/");
                return (
                  <Button
                    key={nextPath}
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadFolderBrowserPath(folderBrowser.volumeRowId, nextPath)}
                    disabled={isFolderBrowserLoading}
                  >
                    {segment}
                  </Button>
                );
              })}
              <Button
                className="ml-auto"
                variant="outline"
                size="sm"
                onClick={() => folderBrowser && void loadFolderBrowserPath(folderBrowser.volumeRowId, folderBrowser.currentPath)}
                disabled={isFolderBrowserLoading}
              >
                {isFolderBrowserLoading ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                Refresh
              </Button>
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border">
              {isFolderBrowserLoading ? (
                <div className="flex items-center justify-center gap-2 px-4 py-12 text-sm text-muted-foreground">
                  <Spinner className="h-4 w-4" />
                  Loading folders...
                </div>
              ) : null}
              {!isFolderBrowserLoading && folderBrowser?.entries.filter((entry) => entry.type === "directory").length === 0 ? (
                <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No folders found.
                </div>
              ) : null}
              {!isFolderBrowserLoading
                ? folderBrowser?.entries
                    .filter((entry) => entry.type === "directory")
                    .map((entry) => (
                      <button
                        key={entry.path}
                        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left transition hover:bg-muted/50 last:border-b-0"
                        onClick={() => folderBrowser && void loadFolderBrowserPath(folderBrowser.volumeRowId, entry.path)}
                        type="button"
                      >
                        <FolderOpen className="h-4 w-4 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{entry.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{entry.path}</span>
                        </span>
                      </button>
                    ))
                : null}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFolderBrowser(null)}>
              Cancel
            </Button>
            <Button onClick={useSelectedFolder} disabled={!folderBrowser?.currentHostPath}>
              Use this folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
