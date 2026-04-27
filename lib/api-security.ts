import { getSession, type AppSession } from "@/lib/getSession";

type AppRole = "ADMIN" | "MOD" | "USER";

type RateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
};

type ApiAccessOptions = {
  roles?: AppRole[];
  rateLimit?: RateLimitOptions;
  allowMissingOrigin?: boolean;
};

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

const RATE_LIMIT_STORE_SYMBOL = Symbol.for("server-manager.rate-limit-store");
const globalRateLimitStore = globalThis as typeof globalThis & {
  [RATE_LIMIT_STORE_SYMBOL]?: Map<string, RateLimitEntry>;
};

function getRateLimitStore() {
  if (!globalRateLimitStore[RATE_LIMIT_STORE_SYMBOL]) {
    globalRateLimitStore[RATE_LIMIT_STORE_SYMBOL] = new Map<string, RateLimitEntry>();
  }

  return globalRateLimitStore[RATE_LIMIT_STORE_SYMBOL];
}

function parseCsvEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function getConfiguredAllowedOrigins() {
  const configuredOrigins = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS);
  const appUrl = process.env.NEXTAUTH_URL?.trim();

  if (appUrl) {
    configuredOrigins.unshift(appUrl);
  }

  return Array.from(new Set(configuredOrigins));
}

function getRequestOrigin(request: Request) {
  return new URL(request.url).origin;
}

function getRequestHostOrigins(request: Request) {
  const host = request.headers.get("host")?.trim();
  if (!host) return [];

  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const protocols = new Set(["http", "https"]);

  if (forwardedProto) {
    protocols.add(forwardedProto);
  }

  return Array.from(protocols).map((protocol) => `${protocol}://${host}`);
}

export function isTrustedOrigin(request: Request, origin: string) {
  const normalizedOrigin = origin.trim().replace(/\/+$/, "");
  const requestOrigins = [getRequestOrigin(request), ...getRequestHostOrigins(request)].map((value) =>
    value.replace(/\/+$/, "")
  );

  if (requestOrigins.includes(normalizedOrigin)) {
    return true;
  }

  return getConfiguredAllowedOrigins().some(
    (allowedOrigin) => allowedOrigin.replace(/\/+$/, "") === normalizedOrigin
  );
}

function getClientIp(request: Request) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  return "unknown";
}

function buildBaseHeaders() {
  const headers = new Headers();
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  headers.set("Origin-Agent-Cluster", "?1");
  headers.set("Cache-Control", "no-store");

  if (process.env.NODE_ENV === "production") {
    headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
  }

  return headers;
}

function applyCorsHeaders(headers: Headers, request: Request) {
  const origin = request.headers.get("origin");
  headers.append("Vary", "Origin");

  if (!origin || !isTrustedOrigin(request, origin)) {
    return;
  }

  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
}

function withSecurityHeaders(request: Request, init?: ResponseInit) {
  const headers = buildBaseHeaders();

  if (init?.headers) {
    const incomingHeaders = new Headers(init.headers);
    incomingHeaders.forEach((value, key) => {
      headers.set(key, value);
    });
  }

  applyCorsHeaders(headers, request);
  return headers;
}

function checkRateLimit(request: Request, options: RateLimitOptions) {
  const store = getRateLimitStore();
  const now = Date.now();
  const clientId = getClientIp(request);
  const storeKey = `${options.key}:${clientId}`;
  const entry = store.get(storeKey);

  if (!entry || entry.resetAt <= now) {
    store.set(storeKey, {
      count: 1,
      resetAt: now + options.windowMs,
    });
    return null;
  }

  if (entry.count >= options.limit) {
    const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
    return textResponse(request, "Too many requests", {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
      },
    });
  }

  entry.count += 1;
  return null;
}

export function enforceRequestSecurity(
  request: Request,
  options?: Pick<ApiAccessOptions, "allowMissingOrigin" | "rateLimit">
) {
  const origin = request.headers.get("origin");
  const allowMissingOrigin = options?.allowMissingOrigin ?? true;

  if (origin) {
    if (!isTrustedOrigin(request, origin)) {
      return textResponse(request, "Origin not allowed", { status: 403 });
    }
  } else if (!allowMissingOrigin && request.method !== "GET" && request.method !== "HEAD") {
    return textResponse(request, "Origin header required", { status: 400 });
  }

  if (options?.rateLimit) {
    const rateLimitResponse = checkRateLimit(request, options.rateLimit);
    if (rateLimitResponse) {
      return rateLimitResponse;
    }
  }

  return null;
}

export async function requireApiSession(
  request: Request,
  options?: ApiAccessOptions
): Promise<{ session: AppSession } | Response> {
  const securityResponse = enforceRequestSecurity(request, {
    allowMissingOrigin: options?.allowMissingOrigin,
    rateLimit: options?.rateLimit,
  });

  if (securityResponse) {
    return securityResponse;
  }

  const session = await getSession();

  if (!session) {
    return textResponse(request, "Unauthorized", { status: 401 });
  }

  if (options?.roles?.length && !options.roles.includes(session.user.role)) {
    return textResponse(request, "Forbidden", { status: 403 });
  }

  return { session };
}

export function jsonResponse(request: Request, body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: withSecurityHeaders(request, init),
  });
}

export function textResponse(request: Request, body: string, init?: ResponseInit) {
  const headers = withSecurityHeaders(request, init);
  if (!headers.has("Content-Type")) {
    headers.set("Content-Type", "text/plain; charset=utf-8");
  }

  return new Response(body, {
    ...init,
    headers,
  });
}

export function buildOptionsResponse(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !isTrustedOrigin(request, origin)) {
    return textResponse(request, "Origin not allowed", { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: withSecurityHeaders(request),
  });
}
