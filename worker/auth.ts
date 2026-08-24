const SESSION_COOKIE = "voting_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CAPTAIN_TOKEN_VERSION = "v1";

export type Session =
  | { role: "admin"; expiresAt: number }
  | { role: "captain"; challengeId: string; teamId: string; expiresAt: number };

interface StoredSession {
  version: 1;
  role: "admin" | "captain";
  expiresAt: number;
  challengeId?: string;
  teamId?: string;
}

export class AuthenticationError extends Error {
  constructor(
    public readonly code: "INVALID_ACCESS" | "INVALID_SESSION" | "FORBIDDEN",
    public readonly status: 401 | 403,
    message: string,
  ) {
    super(message);
  }
}

export class AuthConfigurationError extends Error {}

function configuredSecret(value: string | undefined, name: string): string {
  if (!value || value.length < 32) {
    throw new AuthConfigurationError(`${name} is missing or too short`);
  }
  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeText(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function decodeText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)),
  );
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function equalSecrets(left: string, right: string): Promise<boolean> {
  const [leftDigest, rightDigest] = await Promise.all([digest(left), digest(right)]);
  return equalBytes(leftDigest, rightDigest);
}

async function signedValue(secret: string, value: string): Promise<string> {
  return bytesToBase64Url(await hmac(secret, value));
}

function captainMessage(challengeId: string, teamId: string): string {
  return `${CAPTAIN_TOKEN_VERSION}:${challengeId}:${teamId}`;
}

export async function createCaptainAccessToken(
  signingSecret: string | undefined,
  challengeId: string,
  teamId: string,
): Promise<string> {
  const secret = configuredSecret(signingSecret, "AUTH_SIGNING_SECRET");
  const signature = await signedValue(secret, captainMessage(challengeId, teamId));
  return `${teamId}.${signature}`;
}

async function verifyCaptainAccessToken(
  db: D1Database,
  signingSecret: string | undefined,
  token: string,
): Promise<{ challengeId: string; teamId: string } | null> {
  const separator = token.indexOf(".");
  if (separator <= 0) return null;

  const teamId = token.slice(0, separator);
  const providedSignature = token.slice(separator + 1);
  const team = await db
    .prepare("SELECT challenge_id FROM teams WHERE id = ?")
    .bind(teamId)
    .first<{ challenge_id: string }>();
  if (!team) return null;

  const expected = await createCaptainAccessToken(
    signingSecret,
    team.challenge_id,
    teamId,
  );
  const expectedSignature = expected.slice(expected.indexOf(".") + 1);
  if (!(await equalSecrets(providedSignature, expectedSignature))) return null;

  return { challengeId: team.challenge_id, teamId };
}

export async function exchangeAccess(
  db: D1Database,
  env: Pick<Cloudflare.Env, "ADMIN_ACCESS_TOKEN" | "AUTH_SIGNING_SECRET">,
  input: unknown,
): Promise<Session> {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const kind = typeof body.kind === "string" ? body.kind : "";
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;

  if (kind === "admin") {
    const expected = configuredSecret(env.ADMIN_ACCESS_TOKEN, "ADMIN_ACCESS_TOKEN");
    if (!token || !(await equalSecrets(token, expected))) {
      throw new AuthenticationError(
        "INVALID_ACCESS",
        401,
        "Dieser Einladungslink ist nicht gültig. Bitte prüfe den verwendeten Link.",
      );
    }
    return { role: "admin", expiresAt };
  }

  if (kind === "captain") {
    const identity = token
      ? await verifyCaptainAccessToken(db, env.AUTH_SIGNING_SECRET, token)
      : null;
    if (!identity) {
      throw new AuthenticationError(
        "INVALID_ACCESS",
        401,
        "Dieser Einladungslink ist nicht gültig. Bitte frag euren Organisator nach dem aktuellen Link.",
      );
    }
    return { role: "captain", ...identity, expiresAt };
  }

  throw new AuthenticationError(
    "INVALID_ACCESS",
    401,
    "Dieser Einladungslink ist nicht gültig.",
  );
}

function storedSession(session: Session): StoredSession {
  return session.role === "admin"
    ? { version: 1, role: "admin", expiresAt: session.expiresAt }
    : {
        version: 1,
        role: "captain",
        challengeId: session.challengeId,
        teamId: session.teamId,
        expiresAt: session.expiresAt,
      };
}

async function serializeSession(
  signingSecret: string | undefined,
  session: Session,
): Promise<string> {
  const secret = configuredSecret(signingSecret, "AUTH_SIGNING_SECRET");
  const payload = encodeText(JSON.stringify(storedSession(session)));
  return `${payload}.${await signedValue(secret, payload)}`;
}

function sessionFromStored(value: StoredSession): Session | null {
  if (
    value.version !== 1 ||
    !Number.isInteger(value.expiresAt) ||
    value.expiresAt <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  if (value.role === "admin") return { role: "admin", expiresAt: value.expiresAt };
  if (
    value.role === "captain" &&
    typeof value.challengeId === "string" &&
    typeof value.teamId === "string"
  ) {
    return {
      role: "captain",
      challengeId: value.challengeId,
      teamId: value.teamId,
      expiresAt: value.expiresAt,
    };
  }
  return null;
}

function cookieValue(request: Request): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name === SESSION_COOKIE) return value.join("=");
  }
  return null;
}

export async function readSession(
  request: Request,
  signingSecret: string | undefined,
): Promise<Session | null> {
  const serialized = cookieValue(request);
  if (!serialized) return null;
  const separator = serialized.indexOf(".");
  if (separator <= 0) return null;

  try {
    const secret = configuredSecret(signingSecret, "AUTH_SIGNING_SECRET");
    const payload = serialized.slice(0, separator);
    const providedSignature = base64UrlToBytes(serialized.slice(separator + 1));
    const expectedSignature = await hmac(secret, payload);
    if (!equalBytes(providedSignature, expectedSignature)) return null;
    return sessionFromStored(JSON.parse(decodeText(payload)) as StoredSession);
  } catch {
    return null;
  }
}

export async function sessionCookie(
  requestUrl: string,
  signingSecret: string | undefined,
  session: Session,
): Promise<string> {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${await serializeSession(signingSecret, session)}; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; HttpOnly${secure}; SameSite=Strict; Path=/; Max-Age=0`;
}

export function requireSameOrigin(request: Request): void {
  const requestOrigin = new URL(request.url).origin;
  if (request.headers.get("origin") !== requestOrigin) {
    throw new AuthenticationError("FORBIDDEN", 403, "Diese Aktion ist nicht erlaubt.");
  }
}

export async function requireRole<R extends Session["role"]>(
  request: Request,
  signingSecret: string | undefined,
  role: R,
): Promise<Extract<Session, { role: R }>> {
  const session = await readSession(request, signingSecret);
  if (!session) {
    throw new AuthenticationError(
      "INVALID_SESSION",
      401,
      "Dieser Zugang ist nicht gültig. Bitte öffne deinen persönlichen Link erneut.",
    );
  }
  if (session.role !== role) {
    throw new AuthenticationError("FORBIDDEN", 403, "Diese Aktion ist nicht erlaubt.");
  }
  return session as Extract<Session, { role: R }>;
}
