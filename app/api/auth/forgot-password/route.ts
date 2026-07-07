import { z } from "zod";

import {
  buildOptionsResponse,
  enforceRequestSecurity,
  jsonResponse,
} from "@/lib/api-security";
import { createAuthToken } from "@/lib/auth-tokens";
import { sendAuthEmail } from "@/lib/auth-email";
import { prisma } from "@/lib/prisma";

const forgotPasswordSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
});

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const securityResponse = enforceRequestSecurity(request, {
    allowMissingOrigin: false,
    rateLimit: {
      key: "forgot-password",
      limit: 5,
      windowMs: 10 * 60 * 1000,
    },
  });

  if (securityResponse) {
    return securityResponse;
  }

  const parsedBody = forgotPasswordSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return jsonResponse(request, { success: true });
  }

  const { email } = parsedBody.data;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user?.emailVerifiedAt) {
    const reset = await createAuthToken(email, "PASSWORD_RESET", 60 * 60 * 1000);
    await sendAuthEmail({
      to: email,
      kind: "reset-password",
      token: reset.token,
      expiresAt: reset.expiresAt,
    });
  }

  return jsonResponse(request, { success: true });
}
