import bcrypt from "bcrypt";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { recordActivity } from "@/lib/activity";
import {
  buildOptionsResponse,
  jsonResponse,
  requireApiSession,
  textResponse,
} from "@/lib/api-security";

const roleSchema = z.enum(["ADMIN", "MOD", "USER"]);

const createUserSchema = z.object({
  email: z.email().transform((value) => value.trim().toLowerCase()),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password is too long")
    .regex(/[a-z]/, "Password must include a lowercase letter")
    .regex(/[A-Z]/, "Password must include an uppercase letter")
    .regex(/[0-9]/, "Password must include a number"),
  role: roleSchema.default("USER"),
});

const updateUserSchema = z.object({
  userId: z.string().min(1),
  role: roleSchema,
});

const deleteUserSchema = z.object({
  userId: z.string().min(1),
});

export function OPTIONS(request: Request) {
  return buildOptionsResponse(request);
}

export async function GET(request: Request) {
  const auth = await requireApiSession(request, { roles: ["ADMIN"] });

  if (auth instanceof Response) {
    return auth;
  }

  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
      orderBy: [{ role: "asc" }, { email: "asc" }],
    });

    return jsonResponse(request, users);
  } catch (err) {
    console.error(err);
    return textResponse(request, "Failed to load users", { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN"],
    allowMissingOrigin: false,
    rateLimit: {
      key: "user-create",
      limit: 10,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const parsedBody = createUserSchema.safeParse(await request.json());
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

  const { email, password, role } = parsedBody.data;

  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return jsonResponse(request, { error: "User already exists" }, { status: 409 });
    }

    const hashed = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: {
        email,
        password: hashed,
        role,
        emailVerifiedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    await recordActivity({
      actorEmail: auth.session.user.email,
      actorRole: auth.session.user.role,
      action: `created user ${email} with role ${role}`,
    });

    return jsonResponse(request, user, { status: 201 });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Failed to create user", { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN"],
    allowMissingOrigin: false,
    rateLimit: {
      key: "user-update",
      limit: 30,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const parsedBody = updateUserSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return jsonResponse(request, { error: "Invalid request" }, { status: 400 });
  }

  const { userId, role } = parsedBody.data;

  try {
    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
      return textResponse(request, "User not found", { status: 404 });
    }

    if (targetUser.role === "ADMIN") {
      return textResponse(request, "Admin accounts cannot be modified", { status: 403 });
    }

    if (targetUser.email === auth.session.user.email) {
      return textResponse(request, "You cannot change your own role", { status: 400 });
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    await recordActivity({
      actorEmail: auth.session.user.email,
      actorRole: auth.session.user.role,
      action: `changed user ${targetUser.email} role from ${targetUser.role} to ${role}`,
    });

    return jsonResponse(request, updatedUser);
  } catch (err) {
    console.error(err);
    return textResponse(request, "Failed to update user", { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const auth = await requireApiSession(request, {
    roles: ["ADMIN"],
    allowMissingOrigin: false,
    rateLimit: {
      key: "user-delete",
      limit: 20,
      windowMs: 60_000,
    },
  });

  if (auth instanceof Response) {
    return auth;
  }

  const parsedBody = deleteUserSchema.safeParse(await request.json());
  if (!parsedBody.success) {
    return jsonResponse(request, { error: "Invalid request" }, { status: 400 });
  }

  try {
    const targetUser = await prisma.user.findUnique({
      where: { id: parsedBody.data.userId },
      select: { id: true, email: true, role: true },
    });

    if (!targetUser) {
      return textResponse(request, "User not found", { status: 404 });
    }

    if (targetUser.role === "ADMIN") {
      return textResponse(request, "Admin accounts cannot be deleted", { status: 403 });
    }

    if (targetUser.email === auth.session.user.email) {
      return textResponse(request, "You cannot delete your own account", { status: 400 });
    }

    await prisma.user.delete({ where: { id: targetUser.id } });

    await recordActivity({
      actorEmail: auth.session.user.email,
      actorRole: auth.session.user.role,
      action: `deleted user ${targetUser.email} with role ${targetUser.role}`,
    });

    return jsonResponse(request, { success: true });
  } catch (err) {
    console.error(err);
    return textResponse(request, "Failed to delete user", { status: 500 });
  }
}
