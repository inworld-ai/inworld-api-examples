import { useState, type FormEvent } from "react";

const JURISDICTIONS = [
  { code: "US", label: "United States" },
  { code: "US-CA", label: "United States - California" },
  { code: "US-TX", label: "United States - Texas" },
  { code: "US-NY", label: "United States - New York" },
  { code: "GB", label: "United Kingdom" },
  { code: "DE", label: "Germany" },
  { code: "FR", label: "France" },
  { code: "JP", label: "Japan" },
  { code: "KR", label: "South Korea" },
  { code: "AU", label: "Australia" },
  { code: "CA", label: "Canada" },
  { code: "BR", label: "Brazil" },
];

interface Props {
  onSubmit: (data: {
    name: string;
    age: string;
    dateOfBirth: string;
    jurisdiction: string;
  }) => void;
}

export default function AgeGate({ onSubmit }: Props) {
  const [name, setName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [jurisdiction, setJurisdiction] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function calculateAge(dob: string): string {
    const birth = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) {
      age--;
    }
    return String(age);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name || !dateOfBirth || !jurisdiction) return;

    setSubmitting(true);
    try {
      await onSubmit({
        name,
        age: calculateAge(dateOfBirth),
        dateOfBirth,
        jurisdiction,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="age-gate">
      <div className="card">
        <h2>Welcome</h2>
        <p>Before you can start a voice conversation, we need to verify a few things.</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="dob">Date of Birth</label>
            <input
              id="dob"
              type="date"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
              required
              max={new Date().toISOString().split("T")[0]}
            />
          </div>

          <div className="form-group">
            <label htmlFor="jurisdiction">Location</label>
            <select
              id="jurisdiction"
              value={jurisdiction}
              onChange={(e) => setJurisdiction(e.target.value)}
              required
            >
              <option value="">Select your location</option>
              {JURISDICTIONS.map((j) => (
                <option key={j.code} value={j.code}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>

          <button className="btn btn-primary" type="submit" disabled={submitting}>
            {submitting ? "Verifying..." : "Continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
