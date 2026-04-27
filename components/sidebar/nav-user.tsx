"use client"

import { ChevronRight, LogOut } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { signOut } from "next-auth/react"
import { useRouter } from "next/navigation"

export function NavUserSkeleton() {
  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" className="w-full">
          <div className="flex w-full items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-full" />
            <div className="flex flex-1 flex-col gap-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
            <Skeleton className="ml-auto h-4 w-4" />
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

type Role = "USER" | "MOD" | "ADMIN";

export function NavUser({
  user,
}: {
  user: {
    id: string;
    email: string;
    role: "USER" | "MOD" | "ADMIN";
  }
}) {
  const router = useRouter();
  const { isMobile } = useSidebar()

  const handleSignOut = async () => {
    await signOut()
    router.replace("/auth/login")
    router.refresh()
  }

  function getDisplayRole(role: Role) {
    switch (role) {
      case "USER":
        return "user";
      case "MOD":
        return "moderator";
      case "ADMIN":
        return "admin";
      default:
        return "unknown";
    }
  }

  const displayRole = getDisplayRole(user.role);
  const roleCapitalize = displayRole[0].toUpperCase() + displayRole.slice(1).toLowerCase();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.email}</span>
                <span className="truncate text-xs">{roleCapitalize}</span>
              </div>
              <ChevronRight className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user.email}</span>
                  <span className="truncate text-xs">{roleCapitalize}</span>
                </div>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut}>
              <LogOut />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
