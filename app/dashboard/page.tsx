'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { redirect } from 'next/navigation';

interface Container {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
}

interface SystemInfo {
    cpu: { usage: number; cores: number };
    memory: { total: number; used: number; free: number; usedPercent: number };
    disk: { mount: string; size: number; used: number; available: number; usedPercent: number }[];
    uptime: number;
    processes: {
        all: number;
        running: number;
        list: { pid: number; name: string; cpu: number; mem: number; state: string }[];
    };
}

interface ActivityLog {
    id: string;
    actorEmail: string;
    actorRole: 'ADMIN' | 'MOD' | 'USER';
    action: string;
    containerName: string | null;
    createdAt: string;
}

type QuickActionType = 'restart_all' | 'cleanup_stopped';
interface ImageOption {
    id: string;
    primaryTag: string;
    isDangling: boolean;
}

function isAxiosRejected<T>(
    result: PromiseSettledResult<T>
): result is PromiseRejectedResult {
    return result.status === 'rejected';
}

function getFailedLabel(reason: unknown) {
    if (axios.isAxiosError(reason)) {
        const url = reason.config?.url ?? 'unknown endpoint';
        const status = reason.response?.status;
        if (status) return `${url} (${status})`;
        return url;
    }
    return 'unknown endpoint';
}

function getUsageTextColor(usagePercent: number) {
    if (usagePercent >= 90) return 'text-red-500';
    if (usagePercent >= 75) return 'text-orange-500';
    if (usagePercent >= 55) return 'text-yellow-500';
    return 'text-emerald-500';
}

export default function DashboardPage() {
    const { data: session } = useSession();
    const [containers, setContainers] = useState<Container[]>([]);
    const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
    const [activities, setActivities] = useState<ActivityLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [quickActionLoading, setQuickActionLoading] = useState<string | null>(null);
    const [quickActionMessage, setQuickActionMessage] = useState<string | null>(null);
    const [pendingQuickAction, setPendingQuickAction] = useState<QuickActionType | null>(null);
    const [imageOptions, setImageOptions] = useState<ImageOption[]>([]);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createImageRef, setCreateImageRef] = useState('');
    const [createContainerName, setCreateContainerName] = useState('');
    const [startAfterCreate, setStartAfterCreate] = useState(true);
    const [isCreatingContainer, setIsCreatingContainer] = useState(false);

    useEffect(() => {
        async function fetchData() {
            try {
                const [containersRes, systemRes, activityRes, imagesRes] = await Promise.allSettled([
                    axios.get('/api/containers/list'),
                    axios.get('/api/system/info'),
                    axios.get('/api/activity/recent'),
                    axios.get('/api/images/list'),
                ]);

                if (containersRes.status === 'fulfilled') {
                    setContainers(containersRes.value.data);
                }

                if (systemRes.status === 'fulfilled') {
                    setSystemInfo(systemRes.value.data);
                }

                if (activityRes.status === 'fulfilled') {
                    setActivities(activityRes.value.data);
                }

                if (imagesRes.status === 'fulfilled') {
                    const usableImages = (imagesRes.value.data as ImageOption[]).filter((img) => !img.isDangling);
                    setImageOptions(usableImages);
                    if (usableImages.length > 0) {
                        setCreateImageRef(usableImages[0].primaryTag);
                    }
                }

                const failures = [containersRes, systemRes, activityRes, imagesRes].filter(isAxiosRejected);
                if (failures.length > 0) {
                    const failedTargets = failures.map((failure) => getFailedLabel(failure.reason));
                    setError(`Some dashboard sections could not be loaded: ${failedTargets.join(', ')}`);
                } else {
                    setError(null);
                }
            } finally {
                setIsLoading(false);
            }
        }

        fetchData();
    }, []);

    function formatBytes(bytes: number) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    function getStateColor(state: string) {
        switch (state.toLowerCase()) {
            case 'running':
                return 'bg-green-500';
            case 'exited':
                return 'bg-red-500';
            case 'paused':
                return 'bg-yellow-500';
            default:
                return 'bg-gray-500';
        }
    }

    function formatUptime(seconds: number) {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);

        if (days > 0) return `${days}d ${hours}h ${minutes}m`;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    }

    function formatActivityTime(isoDate: string) {
        return new Date(isoDate).toLocaleString();
    }

    async function reloadDashboardData() {
        const [containersRes, systemRes, activityRes, imagesRes] = await Promise.allSettled([
            axios.get('/api/containers/list'),
            axios.get('/api/system/info'),
            axios.get('/api/activity/recent'),
            axios.get('/api/images/list'),
        ]);

        if (containersRes.status === 'fulfilled') {
            setContainers(containersRes.value.data);
        }

        if (systemRes.status === 'fulfilled') {
            setSystemInfo(systemRes.value.data);
        }

        if (activityRes.status === 'fulfilled') {
            setActivities(activityRes.value.data);
        }

        if (imagesRes.status === 'fulfilled') {
            const usableImages = (imagesRes.value.data as ImageOption[]).filter((img) => !img.isDangling);
            setImageOptions(usableImages);
            if (usableImages.length > 0 && !usableImages.some((img) => img.primaryTag === createImageRef)) {
                setCreateImageRef(usableImages[0].primaryTag);
            }
        }
    }

    async function handleQuickAction(action: QuickActionType) {
        setQuickActionLoading(action);
        setQuickActionMessage(null);

        try {
            const res = await axios.post('/api/containers/bulk', { action });

            const affected = res.data.affected ?? 0;
            if (action === 'restart_all') {
                setQuickActionMessage(`Restarted ${affected} running container(s)`);
            } else {
                setQuickActionMessage(`Cleaned up ${affected} stopped container(s)`);
            }

            await reloadDashboardData();
        } catch (err) {
            console.error(err);
            setQuickActionMessage('Quick action failed');
        } finally {
            setQuickActionLoading(null);
        }
    }

    async function handleCreateContainer() {
        if (!createImageRef) return;

        setIsCreatingContainer(true);
        setQuickActionMessage(null);

        try {
            const res = await axios.post('/api/containers/create', {
                imageRef: createImageRef,
                containerName: createContainerName.trim(),
                startAfterCreate,
            });

            const createdName = res.data?.name ?? 'container';
            setQuickActionMessage(`Created ${createdName}${startAfterCreate ? ' and started it' : ''}`);
            setCreateDialogOpen(false);
            setCreateContainerName('');
            await reloadDashboardData();
        } catch (err) {
            console.error(err);
            setQuickActionMessage('Create container failed');
        } finally {
            setIsCreatingContainer(false);
        }
    }

    function requestQuickActionConfirmation(action: QuickActionType) {
        setPendingQuickAction(action);
    }

    const totalContainers = containers.length;
    const runningContainers = containers.filter((container) => container.state === 'running').length;
    const stoppedContainers = containers.filter((container) => container.state !== 'running').length;
    const isAdmin = session?.user?.role === 'ADMIN';
    const canRestartAll = session?.user?.role === 'ADMIN' || session?.user?.role === 'MOD';
    const canCleanupStopped = session?.user?.role === 'ADMIN';
    const canViewQuickActions = session?.user?.role === 'ADMIN' || session?.user?.role === 'MOD';
    const confirmationTitle =
        pendingQuickAction === 'restart_all' ? 'Confirm restart all containers' : 'Confirm cleanup stopped containers';
    const confirmationDescription =
        pendingQuickAction === 'restart_all'
            ? `This will restart ${runningContainers} running container(s). Services may be briefly interrupted.`
            : `This will permanently remove ${stoppedContainers} stopped container(s). This action cannot be undone.`;
    const cpuUsagePercent = systemInfo?.cpu.usage ?? 0;
    const memoryUsagePercent = systemInfo?.memory.usedPercent ?? 0;
    const diskUsagePercent = systemInfo?.disk[0]?.usedPercent ?? 0;

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <Spinner className='h-8 w-8 mx-auto mb-4 text-muted-foreground' />
                    <p className="text-muted-foreground">Loading containers...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8 space-y-6">
            <div className="container mx-auto">
                {error && (
                    <div className="mb-4 p-3 bg-red-400/20 border border-red-400 text-red-400 rounded-md text-sm">
                        {error}
                    </div>
                )}
                {quickActionMessage && (
                    <div className="mb-4 p-3 bg-green-400/20 border border-green-400 text-green-500 rounded-md text-sm">
                        {quickActionMessage}
                    </div>
                )}

                <div className="mb-3">
                    <h2 className="text-lg font-semibold">Overview</h2>
                    <p className="text-sm text-muted-foreground">Container summary</p>
                </div>

                <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mb-6">
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium">Total Containers</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold">{totalContainers}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium">Running</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-green-400">{runningContainers}</div>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium">Stopped</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-red-400">{stoppedContainers}</div>
                        </CardContent>
                    </Card>
                </div>

                {systemInfo && (
                    <div className="mb-3">
                        <h2 className="text-lg font-semibold">System Status</h2>
                        <p className="text-sm text-muted-foreground">Current health of this server</p>
                    </div>
                )}

                {systemInfo && (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">CPU Usage</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${getUsageTextColor(systemInfo.cpu.usage)}`}>
                                    {systemInfo.cpu.usage.toFixed(1)}%
                                </div>
                                <p className="text-xs text-muted-foreground">{systemInfo.cpu.cores} cores</p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">Memory</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${getUsageTextColor(systemInfo.memory.usedPercent)}`}>
                                    {systemInfo.memory.usedPercent.toFixed(1)}%
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {formatBytes(systemInfo.memory.used)} / {formatBytes(systemInfo.memory.total)}
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">Disk Usage</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className={`text-2xl font-bold ${getUsageTextColor(diskUsagePercent)}`}>
                                    {systemInfo.disk[0] ? `${systemInfo.disk[0].usedPercent.toFixed(1)}%` : 'N/A'}
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {systemInfo.disk[0]
                                        ? `${formatBytes(systemInfo.disk[0].used)} / ${formatBytes(systemInfo.disk[0].size)}`
                                        : 'No disk data'}
                                </p>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-sm font-medium">Uptime</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{formatUptime(systemInfo.uptime)}</div>
                                <p className="text-xs text-muted-foreground">
                                    Server running time
                                </p>
                            </CardContent>
                        </Card>
                    </div>
                )}

                <div className={`grid grid-cols-1 ${canViewQuickActions ? 'xl:grid-cols-3' : ''} gap-6 mb-6`}>
                    <Card className={canViewQuickActions ? 'xl:col-span-2' : ''}>
                        <CardHeader className="space-y-1">
                            <CardTitle className="text-2xl font-bold">Recent Activity</CardTitle>
                            <CardDescription>
                                Latest container actions for debugging
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            {activities.length === 0 ? (
                                <p className="text-sm text-muted-foreground">No activity yet</p>
                            ) : (
                                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                                    {activities.map((item) => (
                                        <div key={item.id} className="flex items-center justify-between rounded-md border p-3">
                                            <div className="text-sm">
                                                <span className="font-semibold">[{item.actorRole}]</span>{' '}
                                                <span>{item.action}</span>{' '}
                                                {item.containerName ? <span className="font-medium">{item.containerName}</span> : null}
                                                <span className="text-muted-foreground"> by {item.actorEmail}</span>
                                            </div>
                                            <Badge variant="outline">{formatActivityTime(item.createdAt)}</Badge>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {canViewQuickActions && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Quick Actions</CardTitle>
                                <CardDescription>Shortcuts for common operations</CardDescription>
                            </CardHeader>
                            <CardContent className="grid gap-2">
                                {isAdmin && (
                                    <Button
                                        variant="outline"
                                        onClick={() => setCreateDialogOpen(true)}
                                    >
                                        + Create container
                                    </Button>
                                )}
                                {isAdmin && (
                                    <Button
                                        variant="outline"
                                        onClick={() => redirect("/files")}
                                    >
                                        Open file manager
                                    </Button>
                                )}
                                {canRestartAll && (
                                    <Button
                                        onClick={() => requestQuickActionConfirmation('restart_all')}
                                        disabled={quickActionLoading === 'restart_all' || runningContainers === 0}
                                    >
                                        {quickActionLoading === 'restart_all' ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                        Restart all
                                    </Button>
                                )}
                                {canCleanupStopped && (
                                    <Button
                                        variant="destructive"
                                        onClick={() => requestQuickActionConfirmation('cleanup_stopped')}
                                        disabled={quickActionLoading === 'cleanup_stopped' || stoppedContainers === 0}
                                    >
                                        {quickActionLoading === 'cleanup_stopped' ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                        Cleanup stopped containers
                                    </Button>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                <Card>
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl font-bold">Containers</CardTitle>
                        <CardDescription>
                            Manage your Docker containers
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {containers.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">No containers found</p>
                        ) : (
                            <div>
                                {containers.map((container) => (
                                    <Button key={container.id} className="flex w-full justify-between min-w-0 px-4 py-6 rounded-none" variant={"ghost"} asChild>
                                        <Link className="flex flex-1 justify-between items-center" href={`/containers/${container.name}`}>
                                            <div className="flex items-center gap-2">
                                                <span className={`w-2 h-2 rounded-full ${getStateColor(container.state)}`}></span>
                                                <span className="font-medium truncate">{container.name}</span>
                                                <p className="text-sm text-gray-500 truncate">{container.image}</p>
                                            </div>
                                            <p className="text-xs text-gray-400 self-center">{container.status}</p>
                                        </Link>
                                    </Button>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            <Dialog open={pendingQuickAction !== null} onOpenChange={(open) => !open && setPendingQuickAction(null)}>
                <DialogContent showCloseButton={false}>
                    <DialogHeader>
                        <DialogTitle>{confirmationTitle}</DialogTitle>
                        <DialogDescription>{confirmationDescription}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button
                            variant="outline"
                            onClick={() => setPendingQuickAction(null)}
                            disabled={quickActionLoading !== null}
                        >
                            Cancel
                        </Button>
                        <Button
                            variant={pendingQuickAction === 'cleanup_stopped' ? 'destructive' : 'default'}
                            onClick={async () => {
                                if (!pendingQuickAction) return;
                                const action = pendingQuickAction;
                                setPendingQuickAction(null);
                                await handleQuickAction(action);
                            }}
                            disabled={quickActionLoading !== null}
                        >
                            Confirm
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
                        <Button
                            variant="outline"
                            onClick={() => setCreateDialogOpen(false)}
                            disabled={isCreatingContainer}
                        >
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
