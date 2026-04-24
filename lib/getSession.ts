import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import type { Session } from "next-auth";

type AppRole = "USER" | "MOD" | "ADMIN";

export type AppSession = Session & {
  user: NonNullable<Session["user"]> & {
    email: string;
    role: AppRole;
  };
};

export async function getSession() {
  return await getServerSession(authOptions) as AppSession | null;
}
