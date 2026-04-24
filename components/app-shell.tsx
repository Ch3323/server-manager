"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "./ui/tooltip";

const AUTH_ROUTES = ["/auth/login", "/auth/register"];

export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const hideSidebar = AUTH_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`)
    );

    if (hideSidebar) {
        return <>{children}</>;
    }

    return (
        <TooltipProvider>
            <SidebarProvider>
                <Suspense>
                    <AppSidebar />
                    <main className="w-full">
                        <SidebarTrigger />
                        {children}
                    </main>
                </Suspense>
            </SidebarProvider>
            <Toaster/>
        </TooltipProvider>
    );
}