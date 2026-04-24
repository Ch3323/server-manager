"use client"

import { FilePenLine, Trophy, Users } from "lucide-react"

import { NavMain } from "@/components/sidebar/nav-main"

type RoleNavProps = {
  role?: string | null
}

export function RoleNav({ role }: RoleNavProps) {
  const isMod = role === "MOD" || role === "ADMIN"
  const isAdmin = role === "ADMIN"

  const items = [
    ...(isMod
      ? [
          
        ]
      : []),
    ...(isAdmin
      ? [
          
        ]
      : []),
  ]

  if (items.length === 0) return null

  return <NavMain items={items} />
}