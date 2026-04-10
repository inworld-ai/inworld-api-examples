import { Router, type Request, type Response } from "express";
import crypto from "crypto";
import { config } from "./config.js";

const router = Router();

const kidHeaders = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${config.kidApiKey}`,
};

// Approved sessions: sessionId -> one-time access token.
// The token is required to open a WebSocket connection.
export const approvedSessions = new Map<string, string>();

/**
 * POST /api/kid/start-session
 * Calls k-ID's E2E widget endpoint to generate a verification URL.
 */
router.post("/start-session", async (req: Request, res: Response) => {
  try {
    const { jurisdiction, dateOfBirth, age } = req.body;

    if (!jurisdiction) {
      res.status(400).json({ error: "jurisdiction is required" });
      return;
    }

    const body: Record<string, unknown> = { jurisdiction };

    if (dateOfBirth) {
      body.dateOfBirth = String(dateOfBirth);
    } else if (age) {
      const parsed = parseInt(String(age), 10);
      if (isNaN(parsed) || parsed < 0 || parsed > 150) {
        res.status(400).json({ error: "invalid age" });
        return;
      }
      body.age = parsed;
    }

    const response = await fetch(
      `${config.kidApiUrl}/api/v1/widget/generate-e2e-url`,
      { method: "POST", headers: kidHeaders, body: JSON.stringify(body) }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[k-ID] API error:", response.status, errorText);
      res.status(response.status).json({ error: errorText });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[k-ID] start-session error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * POST /api/kid/verify
 * Verifies a k-ID session is approved, then issues a one-time access token
 * that the client must pass when opening the WebSocket.
 */
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const sessionId = typeof req.body.sessionId === "string" ? req.body.sessionId : "";
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    // Check session status with k-ID
    const response = await fetch(
      `${config.kidApiUrl}/api/v1/session/get?sessionId=${encodeURIComponent(sessionId)}`,
      { method: "GET", headers: kidHeaders }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[k-ID] verify error:", response.status, errorText);
      res.status(403).json({ approved: false, error: "Session not found" });
      return;
    }

    const session = await response.json();
    console.log("[k-ID] Session verification:", session);
    const ageStatus = session.ageStatus || session.status;

    if (ageStatus === "BLOCKED" || ageStatus === "DENIED") {
      res.json({ approved: false, reason: "blocked" });
      return;
    }

    // Session is approved — issue a one-time access token
    const accessToken = crypto.randomBytes(32).toString("hex");
    approvedSessions.set(accessToken, sessionId);

    // Expire after 5 minutes
    setTimeout(() => approvedSessions.delete(accessToken), 5 * 60 * 1000);

    res.json({ approved: true, accessToken });
  } catch (err) {
    console.error("[k-ID] verify error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/kid/session-status?sessionId=...
 * Retrieves the current session status from k-ID.
 */
router.get("/session-status", async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.query;
    if (!sessionId) {
      res.status(400).json({ error: "sessionId is required" });
      return;
    }

    const response = await fetch(
      `${config.kidApiUrl}/api/v1/session/get?sessionId=${encodeURIComponent(sessionId as string)}`,
      { method: "GET", headers: kidHeaders }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[k-ID] session-status error:", response.status, errorText);
      res.status(response.status).json({ error: errorText });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[k-ID] session-status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * GET /api/kid/challenge-status?challengeId=...
 * Retrieves the status of a verification challenge.
 */
router.get("/challenge-status", async (req: Request, res: Response) => {
  try {
    const { challengeId } = req.query;
    if (!challengeId) {
      res.status(400).json({ error: "challengeId is required" });
      return;
    }

    const response = await fetch(
      `${config.kidApiUrl}/api/v1/challenge/get-status?challengeId=${encodeURIComponent(challengeId as string)}`,
      { method: "GET", headers: kidHeaders }
    );

    if (!response.ok) {
      const errorText = await response.text();
      res.status(response.status).json({ error: errorText });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("[k-ID] challenge-status error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
