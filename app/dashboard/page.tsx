'use client';

import { useEffect, useState } from 'react';
import axios from 'axios';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

interface Container {
    id: string;
    name: string;
    image: string;
    state: string;
    status: string;
}

export default function DashboardPage() {
    const [containers, setContainers] = useState<Container[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        async function fetchContainers() {
            try {
                const res = await axios.get('/api/containers/list');
                setContainers(res.data);
            } catch (err) {
                setError('Failed to load containers');
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }

        fetchContainers();
    }, []);

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
        <div className="p-4 md:p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-2xl font-bold mb-6">Dashboard</h1>
                <Card>
                    <CardHeader className="space-y-1">
                        <CardTitle className="text-2xl font-bold">Containers</CardTitle>
                        <CardDescription>
                            Manage your Docker containers
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {error && (
                            <div className="mb-4 p-3 bg-red-400/20 border border-red-400 text-red-400 rounded-md text-sm">
                                {error}
                            </div>
                        )}

                        {containers.length === 0 ? (
                            <p className="text-gray-500 text-center py-8">No containers found</p>
                        ) : (
                            <div className="space-y-3">
                                {containers.map((container) => (
                                    <div
                                        key={container.id}
                                        className="flex items-center justify-between p-4 border rounded-lg transition-colors"
                                    >
                                        <div className="flex flex-1 justify-between min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span
                                                    className={`w-2 h-2 rounded-full ${getStateColor(container.state)}`}
                                                ></span>
                                                <span className="font-medium truncate">{container.name}</span>
                                                <p className="max-w-md text-sm text-gray-500 truncate">{container.image}</p>
                                            </div>
                                            <p className="text-xs text-gray-400 self-center">{container.status}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}