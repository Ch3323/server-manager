import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import { z } from "zod";
import {
  buildOptionsResponse,
  enforceRequestSecurity,
  jsonResponse,
  textResponse,
} from "@/lib/api-security";

const registerSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z
    .string()
    .min(12, "Password must be at least 12 characters")
    .max(128, "Password is too long")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number"),
});

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function POST(req: Request) {
  const securityResponse = enforceRequestSecurity(req, {
    allowMissingOrigin: false,
    rateLimit: {
      key: "register",
      limit: 5,
      windowMs: 10 * 60 * 1000,
    },
  });

  if (securityResponse) {
    return securityResponse;
  }

  if (process.env.ALLOW_PUBLIC_REGISTRATION === "false") {
    return textResponse(req, "Public registration is disabled", { status: 403 });
  }

  const parsedBody = registerSchema.safeParse(await req.json());

  if (!parsedBody.success) {
    return jsonResponse(
      req,
      {
        error: "Invalid request",
        details: parsedBody.error.flatten().fieldErrors,
      },
      { status: 400 }
    );
  }

  const { email, password } = parsedBody.data;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return jsonResponse(req, { error: "User already exists" }, { status: 409 });
  }

  const hashed = await bcrypt.hash(password, 12);

  await prisma.user.create({
    data: {
      email,
      password: hashed,
    },
  });

  return jsonResponse(req, { success: true }, { status: 201 });
}
