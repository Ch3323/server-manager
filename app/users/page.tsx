"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import axios from "axios";
import { RefreshCw, Save, Search, Trash2, UserPlus, Users } from "lucide-react";

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

type Role = "ADMIN" | "MOD" | "USER";
type WorkspaceAccess = "VIEW" | "EDIT";

type UserItem = {
  id: string;
  email: string;
  role: Role;
  workspacePath: string;
  workspaceAccess: WorkspaceAccess;
  createdAt: string;
};

type AccessDraft = {
  workspacePath: string;
  workspaceAccess: WorkspaceAccess;
};

const roleOptions: Role[] = ["ADMIN", "MOD", "USER"];
const workspaceAccessOptions: WorkspaceAccess[] = ["VIEW", "EDIT"];

function formatDate(value: string) {
  return new Date(value).toLocaleString();
}

function getRoleBadgeVariant(role: Role) {
  if (role === "ADMIN") return "default";
  if (role === "MOD") return "secondary";
  return "outline";
}

function buildAccessDrafts(users: UserItem[]) {
  return Object.fromEntries(
    users.map((user) => [
      user.id,
      {
        workspacePath: user.workspacePath ?? "",
        workspaceAccess: user.workspaceAccess ?? "VIEW",
      },
    ])
  ) as Record<string, AccessDraft>;
}

export default function UsersPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const [users, setUsers] = useState<UserItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");
  const [roleLoadingId, setRoleLoadingId] = useState<string | null>(null);
  const [accessLoadingId, setAccessLoadingId] = useState<string | null>(null);
  const [accessDrafts, setAccessDrafts] = useState<Record<string, AccessDraft>>({});
  const [deleteTarget, setDeleteTarget] = useState<UserItem | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createRole, setCreateRole] = useState<Role>("USER");
  const [createWorkspacePath, setCreateWorkspacePath] = useState("");
  const [createWorkspaceAccess, setCreateWorkspaceAccess] = useState<WorkspaceAccess>("VIEW");
  const [isCreating, setIsCreating] = useState(false);

  const isAdmin = session?.user?.role === "ADMIN";
  const currentEmail = session?.user?.email;

  async function fetchUsers(showSpinner = false) {
    if (showSpinner) setIsRefreshing(true);

    try {
      const res = await axios.get("/api/users");
      const nextUsers = (res.data ?? []) as UserItem[];
      setUsers(nextUsers);
      setAccessDrafts(buildAccessDrafts(nextUsers));
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to load users");
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
    if (!isAdmin) {
      router.push("/dashboard");
      return;
    }

    const timer = setTimeout(() => {
      void fetchUsers();
    }, 0);

    return () => clearTimeout(timer);
  }, [session, status, router, isAdmin]);

  const stats = useMemo(() => {
    return {
      total: users.length,
      admins: users.filter((user) => user.role === "ADMIN").length,
      mods: users.filter((user) => user.role === "MOD").length,
      users: users.filter((user) => user.role === "USER").length,
    };
  }, [users]);

  const filteredUsers = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return users.filter((user) => {
      const matchesKeyword =
        keyword.length === 0 ||
        user.email.toLowerCase().includes(keyword) ||
        user.role.toLowerCase().includes(keyword) ||
        (user.workspacePath ?? "").toLowerCase().includes(keyword) ||
        (user.workspaceAccess ?? "").toLowerCase().includes(keyword);
      const matchesRole = roleFilter === "all" || user.role === roleFilter;
      return matchesKeyword && matchesRole;
    });
  }, [users, search, roleFilter]);

  async function updateUserRole(user: UserItem, role: Role) {
    if (role === user.role) return;

    setRoleLoadingId(user.id);

    try {
      const res = await axios.patch("/api/users", {
        userId: user.id,
        role,
        workspacePath: role === "MOD" ? accessDrafts[user.id]?.workspacePath ?? user.workspacePath ?? "" : "",
        workspaceAccess: role === "MOD" ? accessDrafts[user.id]?.workspaceAccess ?? user.workspaceAccess ?? "VIEW" : "VIEW",
      });
      const updated = res.data as UserItem;
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setAccessDrafts((current) => ({
        ...current,
        [updated.id]: {
          workspacePath: updated.workspacePath ?? "",
          workspaceAccess: updated.workspaceAccess ?? "VIEW",
        },
      }));
      showSuccessToast(`Updated ${user.email} to ${role}`);
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to update user role");
    } finally {
      setRoleLoadingId(null);
    }
  }

  async function updateModeratorAccess(user: UserItem) {
    const draft = accessDrafts[user.id];
    if (!draft || user.role !== "MOD") return;

    setAccessLoadingId(user.id);

    try {
      const res = await axios.patch("/api/users", {
        userId: user.id,
        role: user.role,
        workspacePath: draft.workspacePath,
        workspaceAccess: draft.workspaceAccess,
      });
      const updated = res.data as UserItem;
      setUsers((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setAccessDrafts((current) => ({
        ...current,
        [updated.id]: {
          workspacePath: updated.workspacePath ?? "",
          workspaceAccess: updated.workspaceAccess ?? "VIEW",
        },
      }));
      showSuccessToast(`Updated workspace access for ${user.email}`);
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to update workspace access");
    } finally {
      setAccessLoadingId(null);
    }
  }

  async function createUser() {
    const email = createEmail.trim();
    if (!email || !createPassword) return;

    setIsCreating(true);

    try {
      const res = await axios.post("/api/users", {
        email,
        password: createPassword,
        role: createRole,
        workspacePath: createRole === "MOD" ? createWorkspacePath : "",
        workspaceAccess: createRole === "MOD" ? createWorkspaceAccess : "VIEW",
      });
      const created = res.data as UserItem;
      setUsers((current) => [...current, created].sort((a, b) => a.email.localeCompare(b.email)));
      setAccessDrafts((current) => ({
        ...current,
        [created.id]: {
          workspacePath: created.workspacePath ?? "",
          workspaceAccess: created.workspaceAccess ?? "VIEW",
        },
      }));
      setCreateDialogOpen(false);
      setCreateEmail("");
      setCreatePassword("");
      setCreateRole("USER");
      setCreateWorkspacePath("");
      setCreateWorkspaceAccess("VIEW");
      showSuccessToast(`Created user ${email}`);
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to create user");
    } finally {
      setIsCreating(false);
    }
  }

  async function deleteUser() {
    if (!deleteTarget) return;

    setIsDeleting(true);

    try {
      await axios.delete("/api/users", {
        data: { userId: deleteTarget.id },
      });
      setUsers((current) => current.filter((user) => user.id !== deleteTarget.id));
      setAccessDrafts((current) => {
        const next = { ...current };
        delete next[deleteTarget.id];
        return next;
      });
      showSuccessToast(`Deleted user ${deleteTarget.email}`);
      setDeleteTarget(null);
    } catch (err) {
      console.error(err);
      showErrorToast(err, "Failed to delete user");
    } finally {
      setIsDeleting(false);
    }
  }

  if (isLoading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Spinner className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <p className="text-muted-foreground">Loading users...</p>
        </div>
      </div>
    );
  }

  if (!session || !isAdmin) return null;

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="container mx-auto max-w-7xl space-y-6">
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total</CardDescription>
              <CardTitle className="text-3xl">{stats.total}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Admins</CardDescription>
              <CardTitle className="text-3xl">{stats.admins}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Moderators</CardDescription>
              <CardTitle className="text-3xl">{stats.mods}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Users</CardDescription>
              <CardTitle className="text-3xl">{stats.users}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader className="gap-4">
            <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
              <div>
                <CardTitle className="flex items-center gap-2 text-2xl">
                  <Users className="h-5 w-5" />
                  Users
                </CardTitle>
                <CardDescription className="mt-1">
                  Manage account roles and access.
                </CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => void fetchUsers(true)}
                  disabled={isRefreshing}
                >
                  {isRefreshing ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
                  Refresh
                </Button>
                <Button onClick={() => setCreateDialogOpen(true)}>
                  <UserPlus className="h-4 w-4" />
                  New User
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="relative w-full lg:max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search users..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as Role | "all")}>
                <SelectTrigger className="w-full lg:w-44">
                  <SelectValue placeholder="Filter role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  {roleOptions.map((role) => (
                    <SelectItem key={role} value={role}>
                      {role}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>

          <CardContent>
            <div className="overflow-hidden rounded-lg border">
              <div className="hidden grid-cols-[minmax(0,1fr)_110px_minmax(260px,1fr)_180px_170px] items-center gap-3 bg-muted/40 px-4 py-3 text-xs font-medium uppercase text-muted-foreground lg:grid">
                <span>Email</span>
                <span>Role</span>
                <span>Moderator Workspace</span>
                <span>Created</span>
                <span className="text-right">Actions</span>
              </div>

              <div className="divide-y">
                {filteredUsers.length === 0 ? (
                  <div className="px-4 py-14 text-center text-sm text-muted-foreground">
                    No users found.
                  </div>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelf = user.email === currentEmail;
                    const isProtectedAdmin = user.role === "ADMIN";
                    const isRoleLoading = roleLoadingId === user.id;
                    const isAccessLoading = accessLoadingId === user.id;
                    const accessDraft = accessDrafts[user.id] ?? {
                      workspacePath: user.workspacePath ?? "",
                      workspaceAccess: user.workspaceAccess ?? "VIEW",
                    };
                    const hasAccessChanges =
                      accessDraft.workspacePath.trim() !== (user.workspacePath ?? "") ||
                      accessDraft.workspaceAccess !== (user.workspaceAccess ?? "VIEW");

                    return (
                      <div
                        key={user.id}
                        className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_110px_minmax(260px,1fr)_180px_170px] lg:items-center"
                      >
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-medium">{user.email}</span>
                            {isSelf ? <Badge variant="outline">You</Badge> : null}
                            {isProtectedAdmin ? <Badge variant="outline">Protected</Badge> : null}
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground lg:hidden">
                            Created: {formatDate(user.createdAt)}
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Badge variant={getRoleBadgeVariant(user.role)}>{user.role}</Badge>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px_auto]">
                          {user.role === "MOD" ? (
                            <>
                              <Input
                                value={accessDraft.workspacePath}
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setAccessDrafts((current) => ({
                                    ...current,
                                    [user.id]: {
                                      ...accessDraft,
                                      workspacePath: value,
                                    },
                                  }));
                                }}
                                placeholder="workspace subpath"
                                disabled={isSelf || isAccessLoading}
                              />
                              <Select
                                value={accessDraft.workspaceAccess}
                                onValueChange={(value) => {
                                  setAccessDrafts((current) => ({
                                    ...current,
                                    [user.id]: {
                                      ...accessDraft,
                                      workspaceAccess: value as WorkspaceAccess,
                                    },
                                  }));
                                }}
                                disabled={isSelf || isAccessLoading}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {workspaceAccessOptions.map((access) => (
                                    <SelectItem key={access} value={access}>
                                      {access === "VIEW" ? "View only" : "Edit"}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                onClick={() => void updateModeratorAccess(user)}
                                disabled={isSelf || isAccessLoading || !hasAccessChanges}
                              >
                                {isAccessLoading ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                <span className="sr-only">Save workspace access</span>
                              </Button>
                            </>
                          ) : (
                            <span className="text-sm text-muted-foreground">Not applicable</span>
                          )}
                        </div>

                        <div className="hidden text-sm text-muted-foreground lg:block">
                          {formatDate(user.createdAt)}
                        </div>

                        <div className="flex justify-start gap-2 md:justify-end">
                          <Select
                            value={user.role}
                            onValueChange={(value) => void updateUserRole(user, value as Role)}
                            disabled={isSelf || isProtectedAdmin || isRoleLoading}
                          >
                            <SelectTrigger className="w-28">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {roleOptions.map((role) => (
                                <SelectItem key={role} value={role}>
                                  {role}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setDeleteTarget(user)}
                            disabled={isSelf || isProtectedAdmin}
                          >
                            <Trash2 className="h-4 w-4" />
                            <span className="sr-only">Delete user</span>
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              Create an account and assign the initial role.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={createEmail}
              onChange={(event) => setCreateEmail(event.target.value)}
              placeholder="email@example.com"
              type="email"
            />
            <Input
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
              placeholder="Temporary password"
              type="password"
              minLength={8}
            />
            <Select value={createRole} onValueChange={(value) => setCreateRole(value as Role)}>
              <SelectTrigger>
                <SelectValue placeholder="Role" />
              </SelectTrigger>
              <SelectContent>
                {roleOptions.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {createRole === "MOD" ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px]">
                <Input
                  value={createWorkspacePath}
                  onChange={(event) => setCreateWorkspacePath(event.target.value)}
                  placeholder="workspace subpath"
                />
                <Select
                  value={createWorkspaceAccess}
                  onValueChange={(value) => setCreateWorkspaceAccess(value as WorkspaceAccess)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="VIEW">View only</SelectItem>
                    <SelectItem value="EDIT">Edit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void createUser()}
              disabled={isCreating || createEmail.trim().length === 0 || createPassword.length < 8}
            >
              {isCreating ? <Spinner className="h-4 w-4" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Delete <span className="font-medium">{deleteTarget?.email}</span>? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void deleteUser()} disabled={isDeleting}>
              {isDeleting ? <Spinner className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
