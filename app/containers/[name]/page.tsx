'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';

import axios from 'axios';
import { showErrorToast, showSuccessToast } from '@/lib/client-notify';

interface ContainerListItem {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
    isProtected: boolean;
}

export default function ContainerDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { data: session, status } = useSession();
    const [container, setContainer] = useState<ContainerListItem | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [actionLoading, setActionLoading] = useState<string | null>(null);
    const [logs, setLogs] = useState('');
    const [isLogsLoading, setIsLogsLoading] = useState(false);
    const [logsError, setLogsError] = useState<string | null>(null);

    const containerId = params.name as string;
    const isAdmin = session?.user?.role === 'ADMIN';
    const isModOrAdmin = session?.user?.role === 'ADMIN' || session?.user?.role === 'MOD';
    const isProtected = container?.isProtected ?? false;

    async function fetchLogs(targetContainerId: string) {
        setIsLogsLoading(true);
        setLogsError(null);

        try {
            const res = await axios.get('/api/containers/logs', {
                params: {
                    containerId: targetContainerId,
                    tail: 200,
                },
            });
            setLogs(res.data.logs ?? '');
        } catch (err) {
            console.error(err);
            setLogsError(showErrorToast(err, 'Failed to load container logs'));
        } finally {
            setIsLogsLoading(false);
        }
    }

    useEffect(() => {
        if (status === "loading") return;
        if (!session) {
            router.push('/auth/login');
            return;
        }

        async function fetchContainer() {
            try {
                const res = await axios.get('/api/containers/list');
                const containers = res.data as ContainerListItem[];
                const found = containers.find((c) => c.id === containerId || c.name === containerId);

                if (found) {
                    setContainer(found);
                    await fetchLogs(found.id);
                } else {
                    const message = 'Container not found';
                    setError(message);
                    showErrorToast(new Error(message), message);
                }
            } catch (err) {
                setError(showErrorToast(err, 'Failed to load container'));
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchContainer();
    }, [containerId, session, status, router]);

    async function handleAction(action: string) {
        setActionLoading(action);
        try {
            const res = await axios.post('/api/containers/action', {
                containerId: container?.id,
                action,
            });

            if (res.status === 200) {
                showSuccessToast(`Container ${action} completed`);
                // Refresh container data
                const refreshRes = await axios.get('/api/containers/list');
                const containers = refreshRes.data as ContainerListItem[];
                const found = containers.find((c) => c.id === containerId || c.name === containerId);
                if (found) {
                    setContainer(found);
                    await fetchLogs(found.id);
                } else {
                    router.push("/dashboard");
                }
            }
        } catch (err) {
            console.error(`Failed to ${action} container:`, err);
            setError(showErrorToast(err, `Failed to ${action} container`));
        } finally {
            setActionLoading(null);
        }
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

    if (isLoading || status === "loading") {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <Spinner className='h-8 w-8 mx-auto mb-4 text-muted-foreground' />
                    <p className="text-muted-foreground">Loading...</p>
                </div>
            </div>
        );
    }

    if (!session) {
        router.push('/auth/login');
        return null;
    }

    if (error && !container) {
        return (
            <div className="p-4 md:p-8">
                <div className="container mx-auto">
                    <Card>
                        <CardContent className="">
                            <p className="text-center">{error}.</p>
                        </CardContent>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-8">
            <div className="container mx-auto">

                {container && (
                    <>
                        {/* Header */}
                        <Card className="mb-6">
                            <CardHeader>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <span className={`w-3 h-3 rounded-full ${getStateColor(container.state)}`}></span>
                                        <CardTitle className="text-2xl">{container.name}</CardTitle>
                                        {container.isProtected && <Badge variant="secondary">Protected</Badge>}
                                    </div>
                                    <Badge className={`select-none text-white py-1 ${container.state == "running" ? "bg-green-500 hover:bg-green-500" : "bg-red-500 hover:bg-red-500"}`}>
                                        {container.state[0].toUpperCase() + container.state.slice(1)}
                                    </Badge>
                                </div>
                                <CardDescription>{container.id}</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="flex gap-2 flex-wrap">
                                    {isModOrAdmin && container.state !== 'running' && (
                                        <Button
                                            onClick={() => handleAction('start')}
                                            disabled={actionLoading === 'start'}
                                        >
                                            {actionLoading === 'start' ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                            Start
                                        </Button>
                                    )}
                                    {isModOrAdmin && container.state === 'running' && !isProtected && (
                                        <>
                                            <Button
                                                variant="outline"
                                                onClick={() => handleAction('stop')}
                                                disabled={actionLoading === 'stop'}
                                            >
                                                {actionLoading === 'stop' ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                                Stop
                                            </Button>
                                            <Button
                                                variant="outline"
                                                onClick={() => handleAction('restart')}
                                                disabled={actionLoading === 'restart'}
                                            >
                                                {actionLoading === 'restart' ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                                Restart
                                            </Button>
                                        </>
                                    )}
                                    {isAdmin && !isProtected && (
                                        <Button
                                            variant="destructive"
                                            onClick={() => handleAction('remove')}
                                            disabled={actionLoading === 'remove'}
                                        >
                                            {actionLoading === 'remove' ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                            Delete
                                        </Button>
                                    )}
                                    {!isModOrAdmin && (
                                        <p className="text-sm text-muted-foreground">
                                            Read-only mode: USER can only view container details and logs.
                                        </p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>

                        {/* Details */}
                        <div className="grid gap-6">
                            <Card>
                                <CardHeader>
                                    <CardTitle>Details</CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Image</p>
                                        <p className="mt-1">{container.image}</p>
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium text-muted-foreground">Status</p>
                                        <p className="mt-1">{container.status}</p>
                                    </div>
                                </CardContent>
                            </Card>

                            <Card>
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle>Logs</CardTitle>
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={() => container && fetchLogs(container.id)}
                                        disabled={isLogsLoading}
                                    >
                                        {isLogsLoading ? <Spinner className="h-4 w-4 mr-2" /> : null}
                                        Refresh Logs
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    {logsError ? (
                                        <div className="mb-3 rounded-md border border-red-400 bg-red-400/20 p-3 text-sm text-red-500">
                                            {logsError}
                                        </div>
                                    ) : null}
                                    <pre className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-3 text-xs leading-5 whitespace-pre-wrap break-words">
                                        {logs || 'No logs found'}
                                    </pre>
                                </CardContent>
                            </Card>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
