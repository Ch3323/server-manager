"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "./ui/tooltip";
import { SectionNavBar } from "./sidebar/section-navbar";

const AUTH_ROUTES = ["/auth/login", "/auth/register"];

interface Item {
    label: string,
    href: string,
}

export function AppShell({ children }: { children: ReactNode }) {
    const [items, setItems] = useState<Item[]>([]);

    const pathname = usePathname();
    const hideSidebar = AUTH_ROUTES.some(
        (route) => pathname === route || pathname.startsWith(`${route}/`)
    );

    if (hideSidebar) {
        return <>{children}</>;
    }

    function generateBreadcrump(path: string) {
        const pathArray = path.split('/').slice(1);
        const crumbs: Item[] = pathArray.map((label, i) => ({
            label: label.replace(/[-_]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase()),
            href: "/" + pathArray.slice(0, i + 1).join("/")
        }));
        setItems(crumbs);
    }

    useEffect(() => console.log(items), [items]);

    useEffect(() => {
        generateBreadcrump(pathname);
    }, [pathname]);

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
            <Toaster />
        </TooltipProvider>
    );
}