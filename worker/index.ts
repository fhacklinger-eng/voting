import {
  AuthConfigurationError,
  AuthenticationError,
  clearSessionCookie,
  createCaptainAccessToken,
  createVoterAccessToken,
  exchangeAccess,
  readSession,
  requireRole,
  requireSameOrigin,
  requireVoter,
  sessionCookie,
} from "./auth";
import { ConfigurationValidationError } from "./domain/challenge-setup";
import {
  BallotValidationError,
  BallotWriteConflictError,
  saveCompleteBallot,
} from "./persistence/ballots";
import {
  ConfigurationConflictError,
  readChallengeConfiguration,
  saveChallengeConfiguration,
} from "./persistence/challenges";
import {
  closeDinner,
  DinnerTransitionError,
  openDinner,
  readAdminDashboard,
  reopenDinner,
} from "./persistence/dinners";
import {
  readRevealedResults,
  revealChallenge,
  RevealError,
  ResultsUnavailableError,
} from "./persistence/results";
import {
  readVoterBallot,
  readVoterDashboard,
  readVoterIdentity,
  VoterDataError,
} from "./persistence/voters";

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

class InvalidJsonError extends Error {}

function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  return json({ error: { code, message, ...extra } }, { status });
}

async function parseJson(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new InvalidJsonError("JSON_REQUIRED");
  }
  try {
    return await request.json();
  } catch {
    throw new InvalidJsonError("INVALID_JSON");
  }
}

async function health(env: Cloudflare.Env): Promise<Response> {
  try {
    await env.DB.prepare("SELECT COUNT(*) AS count FROM challenges").first();
    return json({ service: "voting", status: "ok", database: "ready" });
  } catch {
    return errorResponse(503, "DATABASE_NOT_READY", "Die Datenbank ist noch nicht eingerichtet.");
  }
}

async function sessionExchange(request: Request, env: Cloudflare.Env): Promise<Response> {
  requireSameOrigin(request);
  const session = await exchangeAccess(env.DB, env, await parseJson(request));
  return json(
    { session: { role: session.role } },
    {
      headers: {
        "Set-Cookie": await sessionCookie(request.url, env.AUTH_SIGNING_SECRET, session),
      },
    },
  );
}

async function sessionMe(request: Request, env: Cloudflare.Env): Promise<Response> {
  const session = await readSession(request, env.AUTH_SIGNING_SECRET);
  if (!session) {
    throw new AuthenticationError(
      "INVALID_SESSION",
      401,
      "Dieser Zugang ist nicht gültig. Bitte öffne deinen persönlichen Link erneut.",
    );
  }
  if (session.role === "admin") return json({ session: { role: "admin" } });
  return json({
    session: await readVoterIdentity(env.DB, session.challengeId, session.voterId),
  });
}

async function adminChallenge(request: Request, env: Cloudflare.Env): Promise<Response> {
  await requireRole(request, env.AUTH_SIGNING_SECRET, "admin");
  if (request.method === "GET") {
    return json({ challenge: await readChallengeConfiguration(env.DB) });
  }
  if (request.method === "PUT") {
    requireSameOrigin(request);
    return json({ challenge: await saveChallengeConfiguration(env.DB, await parseJson(request)) });
  }
  return errorResponse(405, "METHOD_NOT_ALLOWED", "Diese Aktion wird nicht unterstützt.");
}

async function accessLinks(
  request: Request,
  env: Cloudflare.Env,
  includeJury: boolean,
): Promise<Response> {
  await requireRole(request, env.AUTH_SIGNING_SECRET, "admin");
  const challenge = await readChallengeConfiguration(env.DB);
  if (!challenge) return json({ links: [] });
  const origin = new URL(request.url).origin;
  const captainLinks = await Promise.all(
    challenge.teams.map(async (team) => ({
      voterId: team.id,
      role: "captain" as const,
      displayName: team.captainName,
      teamName: team.name,
      captainName: team.captainName,
      link: `${origin}/#/access/captain/${await createCaptainAccessToken(
        env.AUTH_SIGNING_SECRET,
        challenge.id,
        team.id,
      )}`,
    })),
  );
  if (!includeJury) return json({ links: captainLinks });

  const juryLinks = await Promise.all(
    challenge.juryMembers.map(async (member) => ({
      voterId: member.id,
      role: "jury" as const,
      displayName: member.name,
      teamName: null,
      link: `${origin}/#/access/jury/${await createVoterAccessToken(
        env.AUTH_SIGNING_SECRET,
        "jury",
        challenge.id,
        member.id,
      )}`,
    })),
  );
  return json({ links: [...captainLinks, ...juryLinks] });
}

async function changeDinner(
  request: Request,
  env: Cloudflare.Env,
  dinnerId: string,
  action: "open" | "close" | "reopen",
): Promise<Response> {
  await requireRole(request, env.AUTH_SIGNING_SECRET, "admin");
  requireSameOrigin(request);
  if (action === "open") await openDinner(env.DB, dinnerId);
  if (action === "reopen") await reopenDinner(env.DB, dinnerId);
  if (action === "close") {
    const body = (await parseJson(request)) as Record<string, unknown>;
    await closeDinner(env.DB, dinnerId, body.confirmMissing === true);
  }
  return json({ dashboard: await readAdminDashboard(env.DB) });
}

async function revealResults(request: Request, env: Cloudflare.Env): Promise<Response> {
  await requireRole(request, env.AUTH_SIGNING_SECRET, "admin");
  requireSameOrigin(request);
  const body = (await parseJson(request)) as Record<string, unknown>;
  await revealChallenge(env.DB, body.confirmMissing === true);
  return json({ revealed: true });
}

async function adminResults(request: Request, env: Cloudflare.Env): Promise<Response> {
  await requireRole(request, env.AUTH_SIGNING_SECRET, "admin");
  return json({ results: await readRevealedResults(env.DB) });
}

async function voterResults(request: Request, env: Cloudflare.Env): Promise<Response> {
  const session = await requireVoter(request, env.AUTH_SIGNING_SECRET);
  await readVoterIdentity(env.DB, session.challengeId, session.voterId);
  return json({
    results: await readRevealedResults(env.DB, session.challengeId),
  });
}

async function voterBallot(
  request: Request,
  env: Cloudflare.Env,
  dinnerId: string,
): Promise<Response> {
  const session = await requireVoter(request, env.AUTH_SIGNING_SECRET);
  if (request.method === "GET") {
    return json({
      ballot: await readVoterBallot(env.DB, session.challengeId, session.voterId, dinnerId),
    });
  }
  if (request.method === "PUT") {
    requireSameOrigin(request);
    const body = (await parseJson(request)) as Record<string, unknown>;
    const rawRatings = Array.isArray(body.ratings) ? body.ratings : [];
    const ratings = rawRatings.map((value) => {
      const rating = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
      return {
        categoryId: typeof rating.categoryId === "string" ? rating.categoryId : "",
        score: typeof rating.score === "number" ? rating.score : Number.NaN,
      };
    });
    await saveCompleteBallot(env.DB, {
      challengeId: session.challengeId,
      dinnerId,
      voterId: session.voterId,
      ratings,
    });
    return json({ saved: true });
  }
  return errorResponse(405, "METHOD_NOT_ALLOWED", "Diese Aktion wird nicht unterstützt.");
}

async function route(request: Request, env: Cloudflare.Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/api/health") return health(env);
  if (request.method === "POST" && url.pathname === "/api/session/exchange") {
    return sessionExchange(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/session/me") {
    return sessionMe(request, env);
  }
  if (request.method === "POST" && url.pathname === "/api/session/logout") {
    requireSameOrigin(request);
    return json(
      { loggedOut: true },
      { headers: { "Set-Cookie": clearSessionCookie(request.url) } },
    );
  }

  if (url.pathname === "/api/admin/challenge") return adminChallenge(request, env);
  if (request.method === "GET" && url.pathname === "/api/admin/dashboard") {
    await requireRole(request, env.AUTH_SIGNING_SECRET, "admin");
    return json({ dashboard: await readAdminDashboard(env.DB) });
  }
  if (request.method === "GET" && url.pathname === "/api/admin/captain-links") {
    return accessLinks(request, env, false);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/access-links") {
    return accessLinks(request, env, true);
  }
  if (request.method === "POST" && url.pathname === "/api/admin/reveal") {
    return revealResults(request, env);
  }
  if (request.method === "GET" && url.pathname === "/api/admin/results") {
    return adminResults(request, env);
  }
  const adminDinnerMatch = /^\/api\/admin\/dinners\/([^/]+)\/(open|close|reopen)$/.exec(
    url.pathname,
  );
  if (request.method === "POST" && adminDinnerMatch) {
    return changeDinner(
      request,
      env,
      decodeURIComponent(adminDinnerMatch[1]),
      adminDinnerMatch[2] as "open" | "close" | "reopen",
    );
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/api/voter/dashboard" || url.pathname === "/api/captain/dashboard")
  ) {
    const session = await requireVoter(request, env.AUTH_SIGNING_SECRET);
    return json({
      dashboard: await readVoterDashboard(env.DB, session.challengeId, session.voterId),
    });
  }
  if (
    request.method === "GET" &&
    (url.pathname === "/api/voter/results" || url.pathname === "/api/captain/results")
  ) {
    return voterResults(request, env);
  }
  const voterBallotMatch = /^\/api\/(?:voter|captain)\/dinners\/([^/]+)\/ballot$/.exec(
    url.pathname,
  );
  if (voterBallotMatch) {
    return voterBallot(request, env, decodeURIComponent(voterBallotMatch[1]));
  }

  if (url.pathname.startsWith("/api/")) {
    return errorResponse(404, "NOT_FOUND", "Diese API-Route existiert nicht.");
  }
  return new Response(null, { status: 404 });
}

function knownError(error: unknown): Response | null {
  if (error instanceof AuthenticationError) {
    return errorResponse(error.status, error.code, error.message);
  }
  if (error instanceof AuthConfigurationError) {
    return errorResponse(
      503,
      "AUTH_NOT_CONFIGURED",
      "Der Zugang ist noch nicht eingerichtet.",
    );
  }
  if (error instanceof ConfigurationValidationError) {
    return errorResponse(422, "VALIDATION_FAILED", error.message, {
      fieldErrors: error.fieldErrors,
    });
  }
  if (error instanceof ConfigurationConflictError) {
    return errorResponse(409, error.code, error.message);
  }
  if (error instanceof DinnerTransitionError) {
    return errorResponse(409, error.code, error.message, {
      ...(error.missingVoters.length > 0
        ? { missingVoters: error.missingVoters }
        : {}),
    });
  }
  if (error instanceof RevealError) {
    return errorResponse(409, error.code, error.message, {
      ...(error.missingVotes.length > 0 ? { missingVotes: error.missingVotes } : {}),
      ...(error.blockedTeams.length > 0 ? { blockedTeams: error.blockedTeams } : {}),
    });
  }
  if (error instanceof ResultsUnavailableError) {
    return errorResponse(409, "RESULTS_NOT_REVEALED", error.message);
  }
  if (error instanceof VoterDataError) {
    return errorResponse(error.status, error.code, error.message);
  }
  if (error instanceof BallotValidationError) {
    return errorResponse(422, "INVALID_BALLOT", error.message);
  }
  if (error instanceof BallotWriteConflictError) {
    return errorResponse(409, "DINNER_NOT_OPEN", error.message);
  }
  if (error instanceof InvalidJsonError) {
    return errorResponse(400, "INVALID_REQUEST", "Bitte sende gültige JSON-Daten.");
  }
  return null;
}

export default {
  async fetch(request: Request, env: Cloudflare.Env): Promise<Response> {
    try {
      return await route(request, env);
    } catch (error) {
      return (
        knownError(error) ??
        errorResponse(
          500,
          "UNEXPECTED_ERROR",
          "Das hat gerade nicht funktioniert. Bitte versuche es erneut.",
        )
      );
    }
  },
};
