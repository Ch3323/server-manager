import {
  buildOptionsResponse,
  jsonResponse,
  enforceRequestSecurity,
} from "@/lib/api-security";
import { consumeAuthToken } from "@/lib/auth-tokens";
import { prisma } from "@/lib/prisma";

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(request: Request) {
  const securityResponse = enforceRequestSecurity(request, {
    allowMissingOrigin: false,
    rateLimit: {
      key: "verify-email",
      limit: 20,
      windowMs: 60_000,
    },
  });

  if (securityResponse) {
    return securityResponse;
  }

  const body = await request.json();
  const token = typeof body?.token === "string" ? body.token : "";
  if (!token) {
    return jsonResponse(request, { error: "Token required" }, { status: 400 });
  }

  const record = await consumeAuthToken(token, "EMAIL_VERIFICATION");
  if (!record) {
    return jsonResponse(request, { error: "Invalid or expired verification link" }, { status: 400 });
  }

  await prisma.user.update({
    where: { email: record.email },
    data: { emailVerifiedAt: new Date() },
  });

  return jsonResponse(request, { success: true });
}
