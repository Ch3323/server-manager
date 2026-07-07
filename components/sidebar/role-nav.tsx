"use client"

import { Folder, Terminal, Users } from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"

type RoleNavProps = {
  role?: string | null
}

export function RoleNav({ role }: RoleNavProps) {
  const isAdmin = role === "ADMIN"
  const canViewFiles = role === "ADMIN" || role === "MOD"

  const items = [
    ...(canViewFiles
      ? [
        {
          title: "File Manager",
          url: "/files",
          icon: Folder,
        },
      ]
      : []),
    ...(isAdmin
      ? [
        {
          title: "Users",
          url: "/users",
          icon: Users,
        },
        {
          title: "Terminal",
          url: "/terminal",
          icon: Terminal,
        }
      ]
      : []),
  ]

  if (items.length === 0) return null

  return <NavMain items={items} />
}
