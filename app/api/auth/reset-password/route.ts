import bcrypt from "bcrypt";
import { z } from "zod";

import {
  buildOptionsResponse,
  enforceRequestSecurity,
  jsonResponse,
} from "@/lib/api-security";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { prisma } from "@/lib/prisma";

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number"),
});

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const securityResponse = enforceRequestSecurity(request, {
    allowMissingOrigin: false,
    rateLimit: {
      key: "reset-password",
      limit: 10,
      windowMs: 10 * 60 * 1000,
    },
  });

  if (securityResponse) {
    return securityResponse;
  }

  const parsedBody = resetPasswordSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return jsonResponse(
      request,
      {
        error: "Invalid request",
        details: parsedBody.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const record = await consumeAuthToken(parsedBody.data.token, "PASSWORD_RESET");
  if (!record) {
    return jsonResponse(request, { error: "Invalid or expired reset link" }, { status: 400 });
  }

  const hashed = await bcrypt.hash(parsedBody.data.password, 12);
  await prisma.user.update({
    where: { email: record.email },
    data: { password: hashed },
  });

  return jsonResponse(request, { success: true });
}
