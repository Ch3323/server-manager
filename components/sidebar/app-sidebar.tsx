"use client"

import * as React from "react"
import { Container, FileCodeCorner, Folder, LayoutDashboard } from "lucide-react"

import { NavMain } from "./nav-main"
import { NavUser, NavUserSkeleton } from "./nav-user"
import { RoleNav } from "./role-nav"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useSession } from "next-auth/react"
import Image from "next/image"

const navbarMenu = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      isActive: true,
    },
    {
      title: "Containers",
      url: "/containers",
      icon: Container,
    },
    {
      title: "Images",
      url: "/images",
      icon: FileCodeCorner,
    },
  ]
}

type Role = "USER" | "MOD" | "ADMIN";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const { data: session, status } = useSession();

  function getDisplayRole(role: Role | undefined) {
    switch (role) {
      case "USER":
        return "user";
      case "MOD":
        return "moderator";
      case "ADMIN":
        return "admin";
      default:
        return "";
    }
  }

  return (
    <Sidebar className="select-none" collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Image loading="eager" draggable={false} src={"/images/mascot.png"} alt="@ACS" width={128} height={128} className="w-14" style={{ objectFit: "cover" }} />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">SERVER</span>
                <span className="truncate text-xs text-muted-foreground">{getDisplayRole(session?.user?.role).toUpperCase()}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="py-2">
        <NavMain items={navbarMenu.navMain} />
        <RoleNav role={session?.user?.role} />
      </SidebarContent>
      <SidebarFooter>
        {status == "loading" ? <NavUserSkeleton /> : session?.user ? <NavUser user={session.user} /> : null}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}