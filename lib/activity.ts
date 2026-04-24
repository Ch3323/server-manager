import { prisma } from "@/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";

type AppRole = "ADMIN" | "MOD" | "USER";

type ActivityPayload = {
  actorEmail?: string | null;
  actorRole: AppRole;
  action: string;
  containerName?: string;
};

export async function recordActivity(payload: ActivityPayload) {
  const actorEmail = payload.actorEmail?.trim();

  if (!actorEmail) {
    console.warn("Skip activity log: actorEmail is empty", payload);
    return false;
  }

  const activityLog = (
    prisma as typeof prisma & {
      activityLog?: {
        create: (args: {
          data: {
            actorEmail: string;
            actorRole: AppRole;
            action: string;
            containerName?: string;
          };
        }) => Promise<unknown>;
      };
    }
  ).activityLog;

  if (!activityLog) {
    console.error("Skip activity log: prisma.activityLog delegate is unavailable");
    return false;
  }

  try {
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        await activityLog.create({
          data: {
            actorEmail,
            actorRole: payload.actorRole,
            action: payload.action,
            containerName: payload.containerName,
          },
        });
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const isP1017 =
          err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P1017";
        const isTransientConnectionError =
          isP1017 ||
          message.includes("Connection terminated unexpectedly") ||
          message.includes("Server has closed the connection");

        if (!isTransientConnectionError || attempt === 4) {
          throw err;
        }

        // Force reconnect before retrying after transient DB disconnects.
        await prisma.$disconnect().catch(() => undefined);
        const delayMs = attempt * 400;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return false;
  } catch (err) {
    console.error("Failed to record activity:", err, payload);
    return false;
  }
}
