// Inbound call server — Plivo telephony + auto-provisioning. Pipeline logic lives in agent.ts.
import { createServer } from "node:http";
import express from "express";
import plivo from "plivo";
import { WebSocketServer, WebSocket } from "ws";
import { config } from "./config.js";
import { runAgent } from "./agent.js";
import { normalizePhoneNumber } from "../utils.js";

const APP_NAME = "Inworld_STT_LLM_TTS_Voice_Agent";
const plivoClient = new plivo.Client(config.plivoAuthId, config.plivoAuthToken);

async function configurePlivoWebhooks(): Promise<boolean> {
  try {
    const client = plivoClient;
    const answerUrl = `${config.publicUrl}/answer`;
    const hangupUrl = `${config.publicUrl}/hangup`;
    const fallbackUrl = `${config.publicUrl}/fallback`;

    const apps: any = await client.applications.list();
    const existing = (apps?.objects ?? apps ?? []).find((a: any) => a.appName === APP_NAME || a.app_name === APP_NAME);

    let appId: string;
    if (existing) {
      appId = existing.appId ?? existing.app_id;
      await client.applications.update(appId, {
        answerUrl, answerMethod: "POST", hangupUrl, hangupMethod: "POST", fallbackAnswerUrl: fallbackUrl,
      } as any);
    } else {
      const created: any = await client.applications.create(APP_NAME, {
        answerUrl, answerMethod: "POST", hangupUrl, hangupMethod: "POST", fallbackAnswerUrl: fallbackUrl,
      } as any);
      appId = created.appId ?? created.app_id;
    }

    const number = normalizePhoneNumber(config.plivoPhoneNumber);
    if (!number) {
      console.error(`[provision] Invalid phone number: ${config.plivoPhoneNumber}`);
      return false;
    }
    await client.numbers.update(number, { appId });
    console.log(`[provision] Mapped +${number} → ${APP_NAME} (${answerUrl})`);
    return true;
  } catch (err) {
    console.error(`[provision] Failed to configure Plivo: ${(err as Error).message}`);
    return false;
  }
}

let provisioned = false;

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (_req, res) => {
  const phone = normalizePhoneNumber(config.plivoPhoneNumber);
  res.status(provisioned ? 200 : 503).json({
    status: provisioned ? "ok" : "setup-incomplete",
    service: "inworld-stt-llm-tts-inbound",
    phone_number: phone ? `+${phone}` : "not configured",
  });
});

function answerHandler(req: express.Request, res: express.Response) {
  const callId = String(req.body?.CallUUID ?? req.query.CallUUID ?? "");
  const from = String(req.body?.From ?? req.query.From ?? "");
  const to = String(req.body?.To ?? req.query.To ?? "");
  console.log(`[answer] Incoming call: CallUUID=${callId}, From=${from}, To=${to}`);

  const body = Buffer.from(JSON.stringify({ call_uuid: callId, from, to })).toString("base64");
  const wsUrl = `${config.publicUrl.replace(/^http/, "ws")}/ws?body=${body}`;

  const response: any = new (plivo as any).Response();
  response.addStream(wsUrl, { bidirectional: true, keepCallAlive: true, contentType: "audio/x-mulaw;rate=8000" });
  res.type("application/xml").send(response.toXML());
}
app.get("/answer", answerHandler);
app.post("/answer", answerHandler);

app.post("/hangup", (req, res) => {
  console.log(`[hangup] Call ended: CallUUID=${req.body?.CallUUID}, Duration=${req.body?.Duration}s, Cause=${req.body?.HangupCause}`);
  res.type("text/plain").send("OK");
});

app.all("/fallback", (_req, res) => {
  console.warn("[fallback] Fallback webhook triggered");
  const response: any = new (plivo as any).Response();
  response.addSpeak("We're sorry, but we're experiencing technical difficulties. Please try again later.");
  response.addHangup({});
  res.type("application/xml").send(response.toXML());
});

const server = createServer(app);
const wss = new WebSocketServer({ server });

wss.on("connection", (ws: WebSocket, req) => {
  if (!req.url?.startsWith("/ws")) { ws.close(); return; }

  let meta: { call_uuid?: string; from?: string; to?: string } = {};
  try {
    const bodyParam = new URL(req.url, "http://x").searchParams.get("body");
    if (bodyParam) meta = JSON.parse(Buffer.from(bodyParam, "base64").toString());
  } catch { }

  ws.once("message", (data: Buffer) => {
    let start: { event?: string; start?: { callId?: string; streamId?: string } };
    try { start = JSON.parse(data.toString()); } catch { ws.close(); return; }
    if (start.event !== "start") { console.error(`[ws] expected start, got ${start.event}`); ws.close(); return; }

    const resolvedCallId = start.start?.callId || meta.call_uuid;
    const callId = resolvedCallId || "unknown";
    const streamId = start.start?.streamId || "";

    runAgent({
      plivoWs: ws,
      callId,
      streamId,
      fromNumber: meta.from,
      hangup: resolvedCallId
        ? () => plivoClient.calls.hangup(resolvedCallId).then(() => undefined)
        : undefined,
    }).catch((err) => {
      console.error(`[ws] agent error:`, err);
      try { ws.close(); } catch { }
    });
  });
});

async function main() {
  console.log("[server] Configuring Plivo webhooks...");
  provisioned = await configurePlivoWebhooks();
  if (provisioned) {
    console.log(`[server] Ready! Call +${normalizePhoneNumber(config.plivoPhoneNumber)} to test`);
  } else {
    console.warn("[server] ⚠ SETUP INCOMPLETE — Plivo auto-config failed; inbound calls will not route until the number is mapped. Fix the error above.");
  }

  server.listen(config.port, () => {
    console.log(`[server] Listening on port ${config.port}`);
  });
}

process.on("SIGINT", () => { server.close(); process.exit(0); });
process.on("SIGTERM", () => { server.close(); process.exit(0); });

main();
