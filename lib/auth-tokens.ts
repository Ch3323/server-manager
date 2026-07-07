import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/prisma";

type AuthTokenType = "EMAIL_VERIFICATION" | "PASSWORD_RESET";

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAuthToken(email: string, type: AuthTokenType, ttlMs: number) {
  const normalizedEmail = email.trim().toLowerCase();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashAuthToken(token);
  const expiresAt = new Date(Date.now() + ttlMs);

  await prisma.authToken.deleteMany({
    where: {
      email: normalizedEmail,
      type,
    },
  });

  await prisma.authToken.create({
    data: {
      email: normalizedEmail,
      tokenHash,
      type,
      expiresAt,
    },
  });

  return { token, expiresAt };
}

export async function consumeAuthToken(token: string, type: AuthTokenType) {
  const tokenHash = hashAuthToken(token);
  const record = await prisma.authToken.findUnique({
    where: { tokenHash },
  });

  if (!record || record.type !== type || record.expiresAt <= new Date()) {
    if (record) {
      await prisma.authToken.delete({ where: { id: record.id } }).catch(() => undefined);
    }
    return null;
  }

  await prisma.authToken.delete({ where: { id: record.id } });
  return record;
}
