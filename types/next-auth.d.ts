import NextAuth from "next-auth";

declare module "next-auth" {
  interface User {
    role: "USER" | "MOD" | "ADMIN";
  }

  interface Session {
    user: {
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