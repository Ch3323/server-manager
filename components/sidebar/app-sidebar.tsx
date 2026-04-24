"use client"

import * as React from "react"
import { LayoutDashboard } from "lucide-react"

import { NavMain } from "./nav-main"
import { NavUser, NavUserSkeleton } from "./nav-user"
import { RoleNav } from "./role-nav"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar"
import { useSession } from "next-auth/react"


const navbarMenu = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      isActive: true,
    },
  ]
}

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {

  const { data: session, status } = useSession();

  return (
    <Sidebar className="select-none" collapsible="icon" {...props}>
      <SidebarContent>
        <hr />
        <NavMain items={navbarMenu.navMain} />
        <hr />
        <RoleNav role={session?.user?.role} />
      </SidebarContent>
      <SidebarFooter>
        {status == "loading" ? <NavUserSkeleton /> : session?.user ? <NavUser user={session.user} /> : null}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}