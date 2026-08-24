export interface ErrorDetails {
  missingCaptains?: string[];
  missingVotes?: Array<{
    captainName: string;
    captainTeamName: string;
    dinnerId: string;
    dinnerTeamName: string;
    dinnerDate: string;
  }>;
  blockedTeams?: string[];
}

export class ApiRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: ErrorDetails = {},
  ) {
    super(message);
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiRequestError(
      0,
      "NETWORK_ERROR",
      "Keine Verbindung. Prüfe kurz dein Netz und versuche es erneut.",
    );
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // A malformed or empty response is handled like any other server error below.
  }

  if (!response.ok) {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    const error = record.error && typeof record.error === "object"
      ? record.error as Record<string, unknown>
      : {};
    throw new ApiRequestError(
      response.status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error.message === "string"
        ? error.message
        : "Das hat gerade nicht funktioniert. Bitte versuche es erneut.",
      {
        missingCaptains: Array.isArray(error.missingCaptains)
          ? error.missingCaptains.filter((name): name is string => typeof name === "string")
          : undefined,
        missingVotes: Array.isArray(error.missingVotes)
          ? error.missingVotes.filter((vote): vote is NonNullable<ErrorDetails["missingVotes"]>[number] => {
              if (!vote || typeof vote !== "object") return false;
              const record = vote as Record<string, unknown>;
              return (
                typeof record.captainName === "string" &&
                typeof record.captainTeamName === "string" &&
                typeof record.dinnerId === "string" &&
                typeof record.dinnerTeamName === "string" &&
                typeof record.dinnerDate === "string"
              );
            })
          : undefined,
        blockedTeams: Array.isArray(error.blockedTeams)
          ? error.blockedTeams.filter((name): name is string => typeof name === "string")
          : undefined,
      },
    );
  }

  return payload as T;
}

export function jsonRequest(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
