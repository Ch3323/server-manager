import { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaPg } from '@prisma/adapter-pg';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });

function createPrismaClient() {
  return new PrismaClient({
    log: ["query"],
    adapter,
  });
}

function hasActivityLogDelegate(client: PrismaClient) {
  return typeof (client as PrismaClient & { activityLog?: unknown }).activityLog !== "undefined";
}

const cachedPrisma = globalForPrisma.prisma;
export const prisma =
  cachedPrisma && hasActivityLogDelegate(cachedPrisma)
    ? cachedPrisma
    : createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
