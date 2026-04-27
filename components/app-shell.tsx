"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Suspense, useMemo } from "react";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "./ui/tooltip";
import { SectionNavBar } from "./sidebar/section-navbar";

const AUTH_ROUTES = ["/auth/login", "/auth/register"];

interface Item {
    label: string,
    href: string,
}

export function AppShell({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const hideSidebar = AUTH_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`)
    );

    const items = useMemo<Item[]>(() => {
        const pathArray = pathname.split('/').slice(1);
        return pathArray.map((label, i) => ({
            label: label.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()),
            href: "/" + pathArray.slice(0, i + 1).join("/")
        }));
    }, [pathname]);

    if (hideSidebar) {
        return <>{children}</>;
    }

    return (
        <TooltipProvider>
            <SidebarProvider>
                <Suspense>
                    <AppSidebar />
                    <main className="w-full">
                        <SectionNavBar items={items} />
                        {children}
                    </main>
                </Suspense>
            </SidebarProvider>
        </TooltipProvider>
    );
}
