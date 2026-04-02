/**
 * Telnyx webhook: answers incoming calls via the Call Control API with
 * bidirectional media streaming pointed at our WebSocket server.
 */
import { Router } from "express";
import { config } from "../config.js";

export const webhookRouter = Router();

webhookRouter.post("/webhook", async (req, res) => {
  const event = req.body?.data?.event_type;

  if (event === "call.initiated") {
    const callControlId = req.body.data.payload.call_control_id;
    console.log(`[webhook] Call initiated (call_control_id: ${callControlId})`);

    const wsUrl = new URL("/media-stream", config.serverUrl);
    wsUrl.protocol = wsUrl.protocol === "http:" ? "ws:" : "wss:";

    try {
      const resp = await fetch(
        `https://api.telnyx.com/v2/calls/${callControlId}/actions/answer`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.telnyxApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stream_url: wsUrl.toString(),
            stream_track: "inbound_track",
            stream_bidirectional_mode: "rtp",
            stream_bidirectional_codec: "PCMU",
          }),
        }
      );

      if (!resp.ok) {
        const body = await resp.text();
        console.error(`[webhook] Telnyx answer failed (${resp.status}): ${body}`);
      }
    } catch (err) {
      console.error("[webhook] Failed to answer call:", err);
    }
  }

  res.sendStatus(200);
});
