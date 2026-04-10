import { useEffect, useRef, useState, useCallback } from "react";

interface Props {
  widgetUrl: string;
  onComplete: (outcome: "approved" | "denied", accessToken?: string) => void;
}

/**
 * Embeds the k-ID CDK widget in an iframe and listens for postMessage events.
 *
 * When k-ID posts a sessionId, we verify server-side and auto-advance.
 * No manual button — progression is fully automatic and server-gated.
 */
export default function KidVerification({ widgetUrl, onComplete }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [phase, setPhase] = useState<"widget" | "validating" | "success">("widget");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const handledRef = useRef(false);

  const verifySession = useCallback(
    async (sid: string) => {
      if (handledRef.current) return;
      handledRef.current = true;
      setPhase("validating");

      try {
        const res = await fetch("/api/kid/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId: sid }),
        });

        const data = await res.json();
        console.log("[k-ID] Verify response:", data);

        if (data.approved && data.accessToken) {
          setPhase("success");
          // Brief pause so the user sees the confirmation
          setTimeout(() => onComplete("approved", data.accessToken), 1500);
        } else {
          onComplete("denied");
        }
      } catch {
        console.error("Failed to verify session");
        handledRef.current = false;
        setPhase("widget");
      }
    },
    [onComplete]
  );

  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      try {
        const hostname = new URL(event.origin).hostname;
        if (hostname !== "localhost" && !hostname.endsWith(".k-id.com")) return;
      } catch {
        return;
      }

      console.log("[k-ID postMessage]", event.data);

      const data = event.data;
      if (!data || typeof data !== "object") return;

      // k-ID nests payload under data.data: { data: { challengeId, sessionId } }
      const payload = data.data;
      if (payload && typeof payload === "object") {
        if (payload.sessionId && !sessionId) {
          console.log("[k-ID] Got sessionId:", payload.sessionId);
          setSessionId(payload.sessionId);
          verifySession(payload.sessionId);
        }
      }

      if (data.sessionId && !sessionId) {
        setSessionId(data.sessionId);
        verifySession(data.sessionId);
      }
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [sessionId, verifySession]);

  if (phase === "validating") {
    return (
      <div className="transition-screen">
        <div className="transition-card">
          <div className="spinner" />
          <p className="transition-text">Validating...</p>
        </div>
      </div>
    );
  }

  if (phase === "success") {
    return (
      <div className="transition-screen">
        <div className="transition-card">
          <p className="transition-check">&#10003;</p>
          <p className="transition-text">You're all set</p>
        </div>
      </div>
    );
  }

  return (
    <div className="verification-screen">
      <div className="verification-card">
        <div className="iframe-container">
          <iframe
            ref={iframeRef}
            src={widgetUrl}
            title="k-ID Verification"
            allow="camera;autoplay;payment;publickey-credentials-get;publickey-credentials-create"
          />
        </div>
      </div>
    </div>
  );
}
