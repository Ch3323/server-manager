"use client";

import { useEffect, useMemo, useState } from "react";
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

type Role = "ADMIN" | "MOD" | "USER";
type ImageAction = "pull" | "tag" | "remove";

interface ImageItem {
  id: string;
  shortId: string;
  repoTags: string[];
  primaryTag: string;
  created: number;
  size: number;
  virtualSize: number;
  containers: number;
  isDangling: boolean;
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let value = bytes;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(2)} ${units[i]}`;
}

function formatDate(unixSeconds: number) {
  if (!unixSeconds) return "-";
  return new Date(unixSeconds * 1000).toLocaleString();
}

export default function ImagesPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [images, setImages] = useState<ImageItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("all");

  const [actionLoading, setActionLoading] = useState<{ imageId: string; action: ImageAction } | null>(null);
  const [bulkLoading, setBulkLoading] = useState(false);

  const [pullImageRef, setPullImageRef] = useState("");
  const [tagTarget, setTagTarget] = useState<ImageItem | null>(null);
  const [tagRepo, setTagRepo] = useState("");
  const [tagName, setTagName] = useState("latest");
  const [deleteTarget, setDeleteTarget] = useState<ImageItem | null>(null);
  const [pendingPrune, setPendingPrune] = useState(false);

  const role = session?.user?.role as Role | undefined;
  const isAdmin = role === "ADMIN";
  const isModOrAdmin = role === "MOD" || role === "ADMIN";
  const isViewOnly = role === "USER";

  async function fetchImages(showSpinner = false) {
    if (showSpinner) setIsRefreshing(true);
    setError(null);

    try {
      const res = await axios.get("/api/images/list");
      setImages(res.data ?? []);
    } catch (err) {
      console.error(err);
      setError("Failed to load images");
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

    const timer = setTimeout(() => {
      void fetchImages();
    }, 0);

    return () => clearTimeout(timer);
  }, [session, status, router]);

  const stats = useMemo(() => {
    const dangling = images.filter((img) => img.isDangling).length;
    const tagged = images.filter((img) => !img.isDangling).length;
    return {
      total: images.length,
      dangling,
      tagged,
    };
  }, [images]);

  const filteredImages = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return images.filter((img) => {
      const matchesKeyword =
        keyword.length === 0 ||
        img.primaryTag.toLowerCase().includes(keyword) ||
        img.id.toLowerCase().includes(keyword) ||
        img.repoTags.some((tag) => tag.toLowerCase().includes(keyword));

      if (!matchesKeyword) return false;

      if (stateFilter === "all") return true;
      if (stateFilter === "tagged") return !img.isDangling;
      if (stateFilter === "dangling") return img.isDangling;
      return true;
    });
  }, [images, search, stateFilter]);

  async function runImageAction(action: ImageAction, image: ImageItem, payload?: Record<string, unknown>) {
    setActionLoading({ imageId: image.id, action });
    setError(null);
    setMessage(null);

    try {
      await axios.post("/api/images/action", {
        action,
        imageId: image.id,
        ...payload,
      });
      setMessage(`Action "${action}" completed for "${image.primaryTag}"`);
      await fetchImages();
    } catch (err) {
      console.error(err);
      setError(`Failed to ${action} "${image.primaryTag}"`);
    } finally {
      setActionLoading(null);
    }
  }

  async function runPull() {
    setActionLoading({ imageId: "__pull__", action: "pull" });
    setError(null);
    setMessage(null);

    try {
      await axios.post("/api/images/action", {
        action: "pull",
        imageRef: pullImageRef.trim(),
      });
      setMessage(`Pulled image "${pullImageRef.trim()}"`);
      setPullImageRef("");
      await fetchImages();
    } catch (err) {
      console.error(err);
      setError("Failed to pull image");
    } finally {
      setActionLoading(null);
    }
  }

  async function runPrune() {
    setBulkLoading(true);
    setError(null);
    setMessage(null);
    try {
      const res = await axios.post("/api/images/bulk", {
        action: "prune_dangling",
      });

      const deletedImages = res.data?.deletedImages ?? 0;
      const reclaimedSpace = res.data?.reclaimedSpace ?? 0;
      setMessage(`Pruned ${deletedImages} dangling image(s), reclaimed ${formatBytes(reclaimedSpace)}.`);
      await fetchImages();
    } catch (err) {
      console.error(err);
      setError("Failed to prune dangling images");
    } finally {
      setBulkLoading(false);
    }
  }

  if (isLoading || status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <Spinner className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
          <p className="text-muted-foreground">Loading images...</p>
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
            <h1 className="text-2xl font-bold">Image Manager</h1>
            <p className="text-sm text-muted-foreground">
              Manage Docker images: fetch, pull, tag, cleanup, and delete.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Total: {stats.total}</Badge>
            <Badge variant="outline">Tagged: {stats.tagged}</Badge>
            <Badge variant="outline">Dangling: {stats.dangling}</Badge>
            <Button variant="outline" onClick={() => fetchImages(true)} disabled={isRefreshing}>
              {isRefreshing ? <Spinner className="h-4 w-4 mr-2" /> : null}
              Refresh
            </Button>
          </div>
        </div>

        {error ? (
          <div className="rounded-md border border-red-400 bg-red-400/20 p-3 text-sm text-red-500">{error}</div>
        ) : null}

        {message ? (
          <div className="rounded-md border border-green-400 bg-green-400/20 p-3 text-sm text-green-500">{message}</div>
        ) : null}

        {isModOrAdmin ? (
          <Card>
            <CardHeader>
              <CardTitle>Image Operations</CardTitle>
              <CardDescription>Pull and maintain image registry/cache on this host.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col md:flex-row gap-2">
                <Input
                  value={pullImageRef}
                  onChange={(e) => setPullImageRef(e.target.value)}
                  placeholder="Pull image (e.g. nginx:latest)"
                />
                <Button
                  onClick={runPull}
                  disabled={actionLoading?.action === "pull" || pullImageRef.trim().length === 0}
                >
                  {actionLoading?.action === "pull" ? <Spinner className="h-4 w-4 mr-2" /> : null}
                  Pull
                </Button>
              </div>
              {isAdmin ? (
                <div>
                  <Button
                    variant="destructive"
                    onClick={() => setPendingPrune(true)}
                    disabled={bulkLoading || stats.dangling === 0}
                  >
                    {bulkLoading ? <Spinner className="h-4 w-4 mr-2" /> : null}
                    Prune Dangling Images
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader className="space-y-3">
            <div>
              <CardTitle>Images</CardTitle>
              <CardDescription>
                Search, filter, inspect, and run per-image actions.
              </CardDescription>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              <Input
                placeholder="Search by tag or image id..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select value={stateFilter} onValueChange={setStateFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All images" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All images</SelectItem>
                  <SelectItem value="tagged">Tagged</SelectItem>
                  <SelectItem value="dangling">Dangling</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => { setSearch(""); setStateFilter("all"); }}>
                Reset filters
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {filteredImages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No images found for this filter.
              </p>
            ) : (
              <div className="space-y-3">
                {filteredImages.map((img) => {
                  const busy = actionLoading?.imageId === img.id;

                  return (
                    <div key={img.id} className="rounded-lg border p-3 space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-semibold truncate">{img.primaryTag}</p>
                            {img.isDangling ? <Badge variant="outline">Dangling</Badge> : null}
                          </div>
                          <p className="text-xs text-muted-foreground break-all">{img.id}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {isModOrAdmin ? (
                            <Button
                              variant="outline"
                              onClick={() => {
                                setTagTarget(img);
                                const [repo = "", tag = "latest"] = img.primaryTag.split(":");
                                setTagRepo(repo === "<none>" ? "" : repo);
                                setTagName(tag || "latest");
                              }}
                              disabled={busy}
                            >
                              Tag
                            </Button>
                          ) : null}
                          {isAdmin ? (
                            <Button
                              variant="destructive"
                              onClick={() => setDeleteTarget(img)}
                              disabled={busy}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-sm">
                        <div>
                          <p className="text-xs text-muted-foreground">Created</p>
                          <p>{formatDate(img.created)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Size</p>
                          <p>{formatBytes(img.size)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Used By Containers</p>
                          <p>{img.containers}</p>
                        </div>
                      </div>
                      {img.repoTags.length > 1 ? (
                        <div>
                          <p className="text-xs text-muted-foreground mb-1">All tags</p>
                          <div className="flex flex-wrap gap-1">
                            {img.repoTags.map((tag) => (
                              <Badge key={`${img.id}-${tag}`} variant="outline">{tag}</Badge>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {isViewOnly ? (
          <p className="text-xs text-muted-foreground">
            You are in view-only mode. USER can view image data only.
          </p>
        ) : null}
      </div>

      <Dialog open={tagTarget !== null} onOpenChange={(open) => !open && setTagTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Tag Image</DialogTitle>
            <DialogDescription>
              Create or update a tag for <span className="font-semibold">{tagTarget?.primaryTag}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              placeholder="Repository (e.g. myrepo/nginx)"
              value={tagRepo}
              onChange={(e) => setTagRepo(e.target.value)}
            />
            <Input
              placeholder="Tag (e.g. stable)"
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTagTarget(null)} disabled={actionLoading !== null}>
              Cancel
            </Button>
            <Button
              disabled={actionLoading !== null || tagRepo.trim().length === 0 || tagName.trim().length === 0}
              onClick={async () => {
                if (!tagTarget) return;
                const target = tagTarget;
                setTagTarget(null);
                await runImageAction("tag", target, {
                  repo: tagRepo.trim(),
                  tag: tagName.trim(),
                });
              }}
            >
              Save Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Confirm Delete Image</DialogTitle>
            <DialogDescription>
              This permanently removes <span className="font-semibold">{deleteTarget?.primaryTag}</span>.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={actionLoading !== null}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={actionLoading !== null}
              onClick={async () => {
                if (!deleteTarget) return;
                const target = deleteTarget;
                setDeleteTarget(null);
                await runImageAction("remove", target);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingPrune} onOpenChange={setPendingPrune}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Confirm Prune Dangling Images</DialogTitle>
            <DialogDescription>
              This removes dangling images only and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPrune(false)} disabled={bulkLoading}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={bulkLoading}
              onClick={async () => {
                setPendingPrune(false);
                await runPrune();
              }}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
