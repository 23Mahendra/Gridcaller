import { useEffect, useState, type ReactNode } from "react";
import { getConsentState, saveConsentState, CONSENT_VERSION } from "../kernel/consent";
import { requestAllAppPermissions } from "../kernel/nativePermissions";
import { Capacitor } from "@capacitor/core";

export function ConsentGate({ children, onAccepted }: { children: ReactNode; onAccepted?: () => void }) {
  const [consent, setConsent] = useState(getConsentState());
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    setConsent(getConsentState());
  }, []);

  const accept = async () => {
    setBusy(true);
    setError("");
    try {
      const permissions = await requestAllAppPermissions();
      const next = saveConsentState({
        agreed: true,
        agreedAt: Date.now(),
        version: CONSENT_VERSION,
        userAgent: navigator.userAgent,
        purpose: "Educational testing and research only. This app is not offered as a business service, product, or commercial platform.",
      });
      if (Capacitor.isNativePlatform()) {
        const missing = [] as string[];
        if (!permissions.microphone) missing.push("Microphone");
        if (!permissions.camera) missing.push("Camera");
        if (!permissions.location) missing.push("Location");
        if (!permissions.bluetooth) missing.push("Bluetooth");
        if (missing.length) {
          setError(`Permissions were requested, but ${missing.join(", ")} still need your confirmation in the system prompt.`);
        }
      }
      setConsent(next);
      setChecked(true);
      onAccepted?.();
    } catch (err: any) {
      setError(err?.message || "Consent could not be completed.");
    } finally {
      setBusy(false);
    }
  };

  if (consent.agreed) {
    return <>{children}</>;
  }

  return (
    <div style={{ minHeight: "100vh", background: "#05070b", color: "#f5f7fa", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ width: "100%", maxWidth: 760, borderRadius: 24, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.16)", boxShadow: "0 20px 60px rgba(0,0,0,0.45)", padding: 24 }}>
        <div style={{ fontSize: 13, letterSpacing: 2, textTransform: "uppercase", color: "#7dd3fc", marginBottom: 10 }}>GridCaller consent gate</div>
        <h1 style={{ margin: "0 0 10px", fontSize: 28 }}>Access is blocked until you explicitly approve</h1>
        <p style={{ margin: "0 0 14px", lineHeight: 1.6, color: "#d7e2ef" }}>
          This application is for educational testing, research, and personal experimentation only. It is not offered as a business service, product, or commercial platform.
        </p>
        <div style={{ marginBottom: 16, padding: 14, borderRadius: 14, background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.14)", lineHeight: 1.6 }}>
          <strong>By continuing, you confirm that:</strong>
          <ul style={{ margin: "8px 0 0 18px", padding: 0 }}>
            <li>You are using this app for education, research, or testing.</li>
            <li>You understand it may request device permissions such as microphone, location, camera, notifications, and Bluetooth.</li>
            <li>You consent to the app operating only within the scope of this purpose.</li>
            <li>You accept that this is not a commercial service and that no business use is implied.</li>
          </ul>
        </div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 16, cursor: "pointer", color: "#f5f7fa" }}>
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
          <span>I acknowledge and agree to the above terms, permissions notice, and educational/research-only purpose.</span>
        </label>
        <button
          onClick={accept}
          disabled={!checked || busy}
          style={{ width: "100%", border: "none", borderRadius: 999, padding: "12px 16px", fontWeight: 800, fontSize: 15, background: checked ? "#22c55e" : "#475569", color: "#fff", cursor: checked && !busy ? "pointer" : "not-allowed" }}
        >
          {busy ? "Preparing access…" : "I agree and continue"}
        </button>
        {error ? <div style={{ marginTop: 12, color: "#fda4af" }}>{error}</div> : null}
      </div>
    </div>
  );
}
