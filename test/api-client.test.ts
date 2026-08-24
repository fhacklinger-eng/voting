import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, apiRequest } from "../src/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("API client error handling", () => {
  it("turns a network failure into an actionable user-facing message", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("socket failed for internal-host-42"),
    );

    await expect(apiRequest("/api/test")).rejects.toMatchObject({
      status: 0,
      code: "NETWORK_ERROR",
      message: "Keine Verbindung. Prüfe kurz dein Netz und versuche es erneut.",
    });
  });

  it("keeps only string validation messages from an error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "Bitte prüfe deine Eingaben.",
            fieldErrors: { name: "Bitte gib einen Namen ein.", ignored: 42 },
          },
        }),
        { status: 422, headers: { "Content-Type": "application/json" } },
      ),
    );

    try {
      await apiRequest("/api/test");
      throw new Error("Expected apiRequest to fail");
    } catch (caught) {
      expect(caught).toBeInstanceOf(ApiRequestError);
      expect(caught).toMatchObject({
        status: 422,
        code: "VALIDATION_FAILED",
        details: { fieldErrors: { name: "Bitte gib einen Namen ein." } },
      });
    }
  });

  it("uses a neutral fallback for a malformed server response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("internal stack trace", { status: 500 }),
    );

    await expect(apiRequest("/api/test")).rejects.toMatchObject({
      status: 500,
      code: "REQUEST_FAILED",
      message: "Das hat gerade nicht funktioniert. Bitte versuche es erneut.",
    });
  });
});
