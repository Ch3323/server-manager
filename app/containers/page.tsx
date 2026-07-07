"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { showErrorToast, showSuccessToast } from "@/lib/client-notify";

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
import { ContainerCreateDialog } from "@/components/container-create-dialog";

type Role = "ADMIN" | "MOD" | "USER";
type ContainerAction = "start" | "stop" | "restart" | "remove" | "rename";
type BulkAction = "restart_all" | "cleanup_stopped";

interface ContainerItem {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  isProtected: boolean;
}

interface ImageOption {
  id: string;
  primaryTag: string;
  isDangling: boolean;
}

const MAX_LOG_CHARS = 200_000;
const LOG_BOTTOM_THRESHOLD_PX = 24;

export default function ContainersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
  const logsRef = useRef<HTMLPreElement | null>(null);
  const shouldAutoScrollLogsRef = useRef(true);
  const shouldForceInitialLogScrollRef = useRef(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [imageOptions, setImageOptions] = useState<ImageOption[]>([]);
  const [isLoadingImageOptions, setIsLoadingImageOptions] = useState(false);

  const role = session?.user?.role as Role | undefined;
  const isAdmin = role === "ADMIN";
  const isModOrAdmin = role === "ADMIN" || role === "MOD";
  const isViewOnly = role === "USER";
  const isLogTargetRunning = logTarget?.state === "running";
  const logStatusLabel = logsError ? "Error" : isLogTargetRunning ? "Live" : "Snapshot";
  const logStatusClass = logsError
    ? "border-red-500/30 bg-red-500/10 text-red-600"
    : isLogTargetRunning
      ? "border-green-500/30 bg-green-500/10 text-green-700"
      : "border-muted-foreground/20 bg-muted text-muted-foreground";

  async function fetchContainers(showSpinner = false) {
    if (showSpinner) setIsRefreshing(true);

    try {
      const res = await axios.get("/api/containers/list");
      setContainers(res.data ?? []);
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to load containers");
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
          })
          .catch((err) => {
            console.error(err);
            showErrorToast(err, "Failed to load images for container creation");
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
    const restartableRunning = containers.filter((item) => item.state === "running" && !item.isProtected).length;
    return { total: containers.length, running, stopped, restartableRunning };
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

  function openLogs(target: ContainerItem) {
    shouldAutoScrollLogsRef.current = true;
    shouldForceInitialLogScrollRef.current = true;
    setLogTarget(target);
    setLogs("");
    setLogsError(null);
    setIsLogsLoading(true);
  }

  const scrollLogsToBottom = useCallback(() => {
    const logsElement = logsRef.current;
    if (!logsElement) return;

    logsElement.scrollTop = logsElement.scrollHeight;
  }, []);

  const scheduleScrollLogsToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(scrollLogsToBottom);
    });
  }, [scrollLogsToBottom]);

  function updateLogAutoScrollPreference() {
    const logsElement = logsRef.current;
    if (!logsElement) return;

    const distanceFromBottom =
      logsElement.scrollHeight - logsElement.scrollTop - logsElement.clientHeight;
    shouldAutoScrollLogsRef.current = distanceFromBottom <= LOG_BOTTOM_THRESHOLD_PX;
  }

  useEffect(() => {
    if (!logTarget || !session) return;

    const params = new URLSearchParams({
      containerId: logTarget.id,
      tail: "250",
    });
    const events = new EventSource(`/api/containers/logs?${params.toString()}`, {
      withCredentials: true,
    });
    const shouldReconnect = logTarget.state === "running";
    shouldAutoScrollLogsRef.current = true;
    shouldForceInitialLogScrollRef.current = true;

    events.onopen = () => {
      setLogsError(null);
      setIsLogsLoading(false);
    };

    events.addEventListener("ready", () => {
      shouldAutoScrollLogsRef.current = true;
      shouldForceInitialLogScrollRef.current = true;
      setLogsError(null);
      setIsLogsLoading(false);
      scheduleScrollLogsToBottom();
    });

    events.addEventListener("log", (event) => {
      setIsLogsLoading(false);
      setLogsError(null);

      try {
        const payload = JSON.parse(event.data) as { chunk?: string };
        if (payload.chunk) {
          setLogs((current) => (current + payload.chunk).slice(-MAX_LOG_CHARS));
        }
      } catch (err) {
        console.error("Failed to parse container log event:", err);
      }
    });

    events.addEventListener("log-error", (event) => {
      setIsLogsLoading(false);

      try {
        const payload = JSON.parse((event as MessageEvent).data) as { message?: string };
        setLogsError(payload.message ?? "Container log stream error");
      } catch {
        setLogsError("Container log stream disconnected. Reconnecting...");
      }
    });

    events.addEventListener("end", () => {
      setIsLogsLoading(false);
      if (!shouldReconnect) {
        events.close();
      }
    });

    events.onerror = () => {
      setIsLogsLoading(false);
      if (!shouldReconnect) {
        events.close();
        return;
      }
      setLogsError("Container log stream disconnected. Reconnecting...");
    };

    return () => {
      events.close();
    };
  }, [logTarget, scheduleScrollLogsToBottom, session]);

  useEffect(() => {
    const logsElement = logsRef.current;
    if (!logsElement) return;
    if (!shouldAutoScrollLogsRef.current && !shouldForceInitialLogScrollRef.current) return;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        logsElement.scrollTop = logsElement.scrollHeight;
      });
      if (logs.length > 0) {
        shouldForceInitialLogScrollRef.current = false;
      }
    });
  }, [logs]);

  useEffect(() => {
    if (!logTarget) return;

    shouldAutoScrollLogsRef.current = true;
    shouldForceInitialLogScrollRef.current = true;
    scheduleScrollLogsToBottom();
  }, [logTarget, scheduleScrollLogsToBottom]);

  async function runContainerAction(action: ContainerAction, target: ContainerItem, payload?: Record<string, unknown>) {
    setActionLoading({ containerId: target.id, action });

    try {
      await axios.post("/api/containers/action", {
        containerId: target.id,
        action,
        ...payload,
      });
      const message = `Action "${action}" completed for "${target.name}"`;
      showSuccessToast(message);
      await fetchContainers();
    } catch (err) {
      console.error(err);
      showErrorToast(err, `Failed to ${action} "${target.name}"`);
    } finally {
      setActionLoading(null);
    }
  }

  async function runBulkAction(action: BulkAction) {
    setBulkLoading(action);

    try {
      const res = await axios.post("/api/containers/bulk", { action });
      const affected = res.data?.affected ?? 0;
      if (action === "restart_all") {
        const message = `Restarted ${affected} restartable running container(s)`;
        showSuccessToast(message);
      } else {
        const message = `Cleaned up ${affected} stopped container(s)`;
        showSuccessToast(message);
      }
      await fetchContainers();
    } catch (err) {
      console.error(err);
      showErrorToast(err, `Bulk action "${action}" failed`);
    } finally {
      setBulkLoading(null);
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
                disabled={bulkLoading === "restart_all" || stats.restartableRunning === 0}
              >
                {bulkLoading === "restart_all" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                Restart All Restartable
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
                  const isProtected = item.isProtected;

                  return (
                    <div key={item.id} className="rounded-lg border p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${getStateDotClass(item.state)}`} />
                            <p className="font-semibold truncate">{item.name}</p>
                            <Badge variant="outline">{item.state}</Badge>
                            {isProtected ? <Badge variant="secondary">Protected</Badge> : null}
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

                          {isModOrAdmin && isRunning && !isProtected ? (
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
                              {!isProtected ? (
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
                              ) : null}
                              {!isProtected ? (
                                <Button
                                  variant="destructive"
                                  onClick={() => setPendingDelete(item)}
                                  disabled={isBusy}
                                >
                                  Delete
                                </Button>
                              ) : null}
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
                ? `This will restart ${stats.restartableRunning} running container(s). Protected containers are skipped.`
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
        <DialogContent className="flex h-[min(86dvh,780px)] max-h-[calc(100dvh-1rem)] !w-[calc(100vw-1rem)] !max-w-[1440px] min-h-0 min-w-0 flex-col gap-0 p-0" showCloseButton={false}>
          <DialogHeader className="shrink-0 border-b bg-muted/20 px-4 py-3 text-left">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle className="text-base">Container Logs</DialogTitle>
                <DialogDescription className="truncate">{logTarget?.name}</DialogDescription>
              </div>
              <Badge variant="outline" className={`shrink-0 ${logStatusClass}`}>
                {isLogsLoading ? "Connecting" : logStatusLabel}
              </Badge>
            </div>
          </DialogHeader>
          {logsError ? <div className="shrink-0 border-b px-4 py-2 text-xs text-red-600">{logsError}</div> : null}
          <pre
            ref={logsRef}
            onScroll={updateLogAutoScrollPreference}
            className="block min-h-0 w-full min-w-0 flex-1 overflow-auto bg-background px-4 py-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
          >
            {isLogsLoading ? "Loading logs..." : logs || "No logs found"}
          </pre>
          <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-x-0 border-b-0 border-t bg-muted/20 px-4 py-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLogTarget(null)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ContainerCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        imageOptions={imageOptions}
        onCreated={fetchContainers}
      />
    </div>
  );
}
