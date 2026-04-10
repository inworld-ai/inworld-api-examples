import { useState } from "react";
import AgeGate from "./components/AgeGate";
import KidVerification from "./components/KidVerification";
import RealtimeChat from "./components/RealtimeChat";

type Screen = "age-gate" | "verification" | "approved" | "denied";

interface UserInfo {
  name: string;
  jurisdiction: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("age-gate");
  const [widgetUrl, setWidgetUrl] = useState("");
  const [userInfo, setUserInfo] = useState<UserInfo>({ name: "", jurisdiction: "" });
  const [accessToken, setAccessToken] = useState("");

  async function handleAgeGateSubmit(data: {
    name: string;
    age: string;
    dateOfBirth: string;
    jurisdiction: string;
  }) {
    setUserInfo({ name: data.name, jurisdiction: data.jurisdiction });

    try {
      const res = await fetch("/api/kid/start-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jurisdiction: data.jurisdiction,
          dateOfBirth: data.dateOfBirth || undefined,
          age: data.dateOfBirth ? undefined : data.age,
          name: data.name,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        alert(`k-ID error: ${err.error || res.statusText}`);
        return;
      }

      const result = await res.json();
      if (result.url) {
        setWidgetUrl(result.url);
        setScreen("verification");
      } else {
        alert("No verification URL returned from k-ID.");
      }
    } catch (err) {
      console.error("Failed to start k-ID session:", err);
      alert("Failed to connect to server. Is the backend running?");
    }
  }

  function handleVerificationComplete(outcome: "approved" | "denied", token?: string) {
    if (outcome === "approved" && token) {
      setAccessToken(token);
    }
    setScreen(outcome);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>k-ID + Inworld Demo</h1>
        <p>Age-verified voice conversations powered by Inworld Realtime API</p>
      </header>

      <main className="app-main">
        {screen === "age-gate" && <AgeGate onSubmit={handleAgeGateSubmit} />}

        {screen === "verification" && (
          <KidVerification
            widgetUrl={widgetUrl}
            onComplete={handleVerificationComplete}
          />
        )}

        {screen === "approved" && (
          <RealtimeChat userName={userInfo.name} accessToken={accessToken} />
        )}

        {screen === "denied" && (
          <div className="denied-screen">
            <div className="denied-card">
              <h2>Access Restricted</h2>
              <p>
                Based on the verification results, access to this experience is
                not available at this time.
              </p>
              <button className="btn" onClick={() => setScreen("age-gate")}>
                Go Back
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
