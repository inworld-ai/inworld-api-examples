import { WebSocket, type WebSocketServer } from "ws";
import { config } from "./config.js";

/**
 * Sets up a WebSocket proxy between the browser and Inworld Realtime API.
 * Browser connects to /ws on our server; we forward to Inworld with auth headers.
 */
export function setupInworldProxy(wss: WebSocketServer) {
  wss.on("connection", (browser) => {
    console.log("[Inworld] Browser connected, opening API session");

    const api = new WebSocket(
      `wss://api.inworld.ai/api/v1/realtime/session?key=voice-${Date.now()}&protocol=realtime`,
      { headers: { Authorization: `Basic ${config.inworldApiKey}` } }
    );

    api.on("open", () => {
      console.log("[Inworld] API connection established");
    });

    api.on("message", (raw) => {
      if (browser.readyState === WebSocket.OPEN) {
        browser.send(raw.toString());
      }
    });

    browser.on("message", (msg) => {
      if (api.readyState === WebSocket.OPEN) {
        api.send(msg.toString());
      }
    });

    browser.on("close", () => {
      console.log("[Inworld] Browser disconnected, closing API session");
      api.close();
    });

    api.on("close", () => {
      if (browser.readyState === WebSocket.OPEN) browser.close();
    });

    api.on("error", (e) => console.error("[Inworld] API error:", e.message));
  });
}
