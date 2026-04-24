import type { DefaultSession, DefaultUser } from "next-auth";

declare module "next-auth" {
  interface User extends DefaultUser {
    role: "USER" | "MOD" | "ADMIN";
  }

  interface Session {
    user: DefaultSession["user"] & {
      id: string;
      email: string;
      role: "USER" | "MOD" | "ADMIN";
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: "USER" | "MOD" | "ADMIN";
  }
}

export {};
