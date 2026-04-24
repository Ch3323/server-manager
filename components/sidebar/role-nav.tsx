"use client"

import { Folder, Terminal } from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"

type RoleNavProps = {
  role?: string | null
}

export function RoleNav({ role }: RoleNavProps) {
  const isAdmin = role === "ADMIN"

  const items = [
    ...(isAdmin
      ? [
        {
          title: "File Manager",
          url: "/files",
          icon: Folder,
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