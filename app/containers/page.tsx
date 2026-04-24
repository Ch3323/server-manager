"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Checkbox } from "@/components/ui/checkbox";

type Role = "ADMIN" | "MOD" | "USER";
type ContainerAction = "start" | "stop" | "restart" | "remove" | "rename";
type BulkAction = "restart_all" | "cleanup_stopped";

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

interface ImageOption {
  id: string;
  primaryTag: string;
  isDangling: boolean;
}

export default function ContainersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  const [actionLoading, setActionLoading] = useState<{ containerId: string; action: ContainerAction } | null>(null);
  const [bulkLoading, setBulkLoading] = useState<BulkAction | null>(null);

  const [pendingBulkAction, setPendingBulkAction] = useState<BulkAction | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ContainerItem | null>(null);

  const [renameTarget, setRenameTarget] = useState<ContainerItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const [logTarget, setLogTarget] = useState<ContainerItem | null>(null);
  const [logs, setLogs] = useState("");
  const [logsError, setLogsError] = useState<string | null>(null);
  const [isLogsLoading, setIsLogsLoading] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createImageRef, setCreateImageRef] = useState("");
  const [createContainerName, setCreateContainerName] = useState("");
  const [startAfterCreate, setStartAfterCreate] = useState(true);
  const [isCreatingContainer, setIsCreatingContainer] = useState(false);
  const [imageOptions, setImageOptions] = useState<ImageOption[]>([]);
  const [isLoadingImageOptions, setIsLoadingImageOptions] = useState(false);

  const role = session?.user?.role as Role | undefined;
  const isAdmin = role === "ADMIN";
  const isModOrAdmin = role === "ADMIN" || role === "MOD";
  const isViewOnly = role === "USER";

  async function fetchContainers(showSpinner = false) {
    if (showSpinner) setIsRefreshing(true);
    setError(null);

    try {
      const res = await axios.get("/api/containers/list");
      setContainers(res.data ?? []);
    } catch (err) {
      console.error(err);
      setError("Failed to load containers");
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.push("/auth/login");
      return;
    }
    const timeoutId = setTimeout(() => {
      void fetchContainers();
      if (session.user.role === "ADMIN") {
        setIsLoadingImageOptions(true);
        void axios
          .get("/api/images/list")
          .then((res) => {
            const usableImages = (res.data as ImageOption[]).filter((img) => !img.isDangling);
            setImageOptions(usableImages);
            if (usableImages.length > 0) {
              setCreateImageRef(usableImages[0].primaryTag);
            }
          })
          .catch((err) => {
            console.error(err);
            setError("Failed to load images for container creation");
          })
          .finally(() => {
            setIsLoadingImageOptions(false);
          });
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [session, status, router]);

  const stats = useMemo(() => {
    const running = containers.filter((item) => item.state === "running").length;
    const stopped = containers.filter((item) => item.state !== "running").length;
    return { total: containers.length, running, stopped };
  }, [containers]);

  const filteredContainers = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return containers.filter((item) => {
      const matchesKeyword =
        keyword.length === 0 ||
        item.name.toLowerCase().includes(keyword) ||
        item.image.toLowerCase().includes(keyword) ||
        item.id.toLowerCase().includes(keyword);

      if (!matchesKeyword) return false;

      if (stateFilter === "all") return true;
      if (stateFilter === "running") return item.state === "running";
      if (stateFilter === "stopped") return item.state !== "running";
      return item.state === stateFilter;
    });
  }, [containers, search, stateFilter]);

  function getStateDotClass(state: string) {
    switch (state.toLowerCase()) {
      case "running":
        return "bg-green-500";
      case "paused":
        return "bg-yellow-500";
      case "exited":
        return "bg-red-500";
      default:
        return "bg-gray-500";
    }
  }

  async function openLogs(target: ContainerItem) {
    setLogTarget(target);
    setLogs("");
    setLogsError(null);
    setIsLogsLoading(true);

    try {
      const res = await axios.get("/api/containers/logs", {
        params: {
          containerId: target.id,
          tail: 250,
        },
      });
      setLogs(res.data.logs ?? "");
    } catch (err) {
      console.error(err);
      setLogsError("Failed to load logs");
    } finally {
      setIsLogsLoading(false);
    }
  }

  async function runContainerAction(action: ContainerAction, target: ContainerItem, payload?: Record<string, unknown>) {
    setActionLoading({ containerId: target.id, action });
    setMessage(null);
    setError(null);

    try {
      await axios.post("/api/containers/action", {
        containerId: target.id,
        action,
        ...payload,
      });
      setMessage(`Action "${action}" completed for "${target.name}"`);
      await fetchContainers();
    } catch (err) {
      console.error(err);
      setError(`Failed to ${action} "${target.name}"`);
    } finally {
      setActionLoading(null);
    }
  }

  async function runBulkAction(action: BulkAction) {
    setBulkLoading(action);
    setMessage(null);
    setError(null);

    try {
      const res = await axios.post("/api/containers/bulk", { action });
      const affected = res.data?.affected ?? 0;
      if (action === "restart_all") {
        setMessage(`Restarted ${affected} running container(s)`);
      } else {
        setMessage(`Cleaned up ${affected} stopped container(s)`);
      }
      await fetchContainers();
    } catch (err) {
      console.error(err);
      setError(`Bulk action "${action}" failed`);
    } finally {
      setBulkLoading(null);
    }
  }

  async function handleCreateContainer() {
    if (!createImageRef) return;
    setIsCreatingContainer(true);
    setError(null);
    setMessage(null);

    try {
      const res = await axios.post("/api/containers/create", {
        imageRef: createImageRef,
        containerName: createContainerName.trim(),
        startAfterCreate,
      });

      const createdName = res.data?.name ?? "container";
      setMessage(`Created ${createdName}${startAfterCreate ? " and started it" : ""}`);
      setCreateDialogOpen(false);
      setCreateContainerName("");
      await fetchContainers();
    } catch (err) {
      console.error(err);
      setError("Failed to create container");
    } finally {
      setIsCreatingContainer(false);
    }
  }

  if (isLoading || status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Spinner className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading containers...</p>
        </div>
      </div>
    );
  }

  if (!session) return null;

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div className="container mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">Container Manager</h1>
            <p className="text-sm text-muted-foreground">
              Manage lifecycle, logs, and maintenance operations for all containers.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Total: {stats.total}</Badge>
            <Badge variant="outline">Running: {stats.running}</Badge>
            <Badge variant="outline">Stopped: {stats.stopped}</Badge>
            {isAdmin ? (
              <Button
                onClick={() => setCreateDialogOpen(true)}
                disabled={isLoadingImageOptions || imageOptions.length === 0}
              >
                + Create Container
              </Button>
            ) : null}
            <Button variant="outline" onClick={() => fetchContainers(true)} disabled={isRefreshing}>
              {isRefreshing ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Refresh
            </Button>
          </div>
        </div>

        {isModOrAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Bulk Operations</CardTitle>
              <CardDescription>Run controlled actions across multiple containers.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                onClick={() => setPendingBulkAction("restart_all")}
                disabled={bulkLoading === "restart_all" || stats.running === 0}
              >
                {bulkLoading === "restart_all" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                Restart All Running
              </Button>
              {isAdmin ? (
                <Button
                  variant="destructive"
                  onClick={() => setPendingBulkAction("cleanup_stopped")}
                  disabled={bulkLoading === "cleanup_stopped" || stats.stopped === 0}
                >
                  {bulkLoading === "cleanup_stopped" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                  Cleanup Stopped
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>Containers</CardTitle>
              <CardDescription>
                Search, filter, inspect, and run actions per container.
              </CardDescription>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 items-center">
              <Input
                placeholder="Search by name, image, or id..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger className="rounded-lg">
                  <SelectValue placeholder="All states" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All states</SelectItem>
                  <SelectItem value="running">Running</SelectItem>
                  <SelectItem value="stopped">Stopped</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="exited">Exited</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => { setSearch(""); setStateFilter("all"); }}>
                Reset filters
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {filteredContainers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">No containers found for this filter.</p>
            ) : (
              <div className="space-y-3">
                {filteredContainers.map((item) => {
                  const isRunning = item.state === "running";
                  const isBusy = actionLoading?.containerId === item.id;

                  return (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${getStateDotClass(item.state)}`} />
                            <p className="font-semibold truncate">{item.name}</p>
                            <Badge variant="outline">{item.state}</Badge>
                          </div>
                          <p className="text-xs text-muted-foreground break-all">{item.id}</p>
                          <p className="text-sm text-muted-foreground">{item.image}</p>
                          <p className="text-xs">{item.status}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button variant="outline" onClick={() => openLogs(item)}>
                            Logs
                          </Button>
                          <Button variant="outline" asChild>
                            <Link href={`/containers/${item.name}`}>Detail</Link>
                          </Button>

                          {isModOrAdmin && !isRunning ? (
                            <Button
                              onClick={() => runContainerAction("start", item)}
                              disabled={isBusy}
                            >
                              {isBusy && actionLoading?.action === "start" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                              Start
                            </Button>
                          ) : null}

                          {isModOrAdmin && isRunning ? (
                            <>
                              <Button
                                variant="outline"
                                onClick={() => runContainerAction("stop", item)}
                                disabled={isBusy}
                              >
                                {isBusy && actionLoading?.action === "stop" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                Stop
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => runContainerAction("restart", item)}
                                disabled={isBusy}
                              >
                                {isBusy && actionLoading?.action === "restart" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                Restart
                              </Button>
                            </>
                          ) : null}

                          {isAdmin ? (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setRenameTarget(item);
                                  setRenameValue(item.name);
                                }}
                                disabled={isBusy}
                              >
                                Rename
                              </Button>
                              <Button
                                variant="destructive"
                                onClick={() => setPendingDelete(item)}
                                disabled={isBusy}
                              >
                                Delete
                              </Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {isViewOnly ? (
          <p className="text-xs text-muted-foreground">
            You are in view-only mode. USER can view container status and logs only.
          </p>
        ) : null}
      </div>

      <Dialog open={pendingBulkAction !== null} onOpenChange={(open) => !open && setPendingBulkAction(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>
              {pendingBulkAction === "restart_all" ? "Confirm Restart All Running" : "Confirm Cleanup Stopped"}
            </DialogTitle>
            <DialogDescription>
              {pendingBulkAction === "restart_all"
                ? `This will restart ${stats.running} running container(s).`
                : `This will permanently remove ${stats.stopped} stopped container(s).`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingBulkAction(null)} disabled={bulkLoading !== null}>
              Cancel
            </Button>
            <Button
              variant={pendingBulkAction === "cleanup_stopped" ? "destructive" : "default"}
              disabled={bulkLoading !== null}
              onClick={async () => {
                if (!pendingBulkAction) return;
                const action = pendingBulkAction;
                setPendingBulkAction(null);
                await runBulkAction(action);
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Confirm Delete Container</DialogTitle>
            <DialogDescription>
              This permanently removes <span className="font-semibold">{pendingDelete?.name}</span>. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={actionLoading !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading !== null}
              onClick={async () => {
                if (!pendingDelete) return;
                const target = pendingDelete;
                setPendingDelete(null);
                await runContainerAction("remove", target);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={renameTarget !== null} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Edit Container</DialogTitle>
            <DialogDescription>
              Rename container <span className="font-semibold">{renameTarget?.name}</span>.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="New container name"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)} disabled={actionLoading !== null}>
              Cancel
            </Button>
            <Button
              disabled={actionLoading !== null || renameValue.trim().length === 0}
              onClick={async () => {
                if (!renameTarget) return;
                const target = renameTarget;
                const nextName = renameValue.trim();
                setRenameTarget(null);
                await runContainerAction("rename", target, { newName: nextName });
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={logTarget !== null} onOpenChange={(open) => !open && setLogTarget(null)}>
        <DialogContent className="sm:max-w-3xl" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Container Logs</DialogTitle>
            <DialogDescription>{logTarget?.name}</DialogDescription>
          </DialogHeader>
          {logsError ? <div className="rounded-md border border-red-400 bg-red-400/20 p-3 text-sm text-red-500">{logsError}</div> : null}
          <pre className="max-h-[60vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5 whitespace-pre-wrap break-words">
            {isLogsLoading ? "Loading logs..." : logs || "No logs found"}
          </pre>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setLogTarget(null)}
            >
              Close
            </Button>
            <Button
              onClick={() => {
                if (!logTarget) return;
                openLogs(logTarget);
              }}
              disabled={isLogsLoading}
            >
              {isLogsLoading ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Refresh Logs
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Create Container</DialogTitle>
            <DialogDescription>
              Create a new container from a pulled image.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <p className="text-sm font-medium">Image</p>
              <Select value={createImageRef} onValueChange={setCreateImageRef}>
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
              <p className="text-sm font-medium">Container Name (optional)</p>
              <Input
                value={createContainerName}
                onChange={(e) => setCreateContainerName(e.target.value)}
                placeholder="my-app-container"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={startAfterCreate}
                onCheckedChange={(checked) => setStartAfterCreate(checked === true)}
              />
              Start container immediately after create
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={isCreatingContainer}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleCreateContainer()}
              disabled={isCreatingContainer || createImageRef.length === 0}
            >
              {isCreatingContainer ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
