export type ConsentState = {
  agreed: boolean;
  agreedAt: number | null;
  version: string;
  userAgent: string;
  purpose: string;
};

export const CONSENT_VERSION = "v1.0";

const CONSENT_KEY = "gridcaller_consent";

function getDefaultPurpose() {
  return "Educational testing and research only. This app is not offered as a business service, product, or commercial platform.";
}

export function getConsentState(): ConsentState {
  if (typeof window === "undefined") return { agreed: false, agreedAt: null, version: CONSENT_VERSION, userAgent: "", purpose: getDefaultPurpose() };
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) {
      return { agreed: false, agreedAt: null, version: CONSENT_VERSION, userAgent: "", purpose: getDefaultPurpose() };
    }
    const parsed = JSON.parse(raw);
    return {
      agreed: !!parsed?.agreed,
      agreedAt: parsed?.agreedAt ?? null,
      version: parsed?.version || CONSENT_VERSION,
      userAgent: parsed?.userAgent || "",
      purpose: parsed?.purpose || getDefaultPurpose(),
    };
  } catch {
    return { agreed: false, agreedAt: null, version: CONSENT_VERSION, userAgent: "", purpose: getDefaultPurpose() };
  }
}

export function saveConsentState(state: Partial<ConsentState>): ConsentState {
  const next: ConsentState = {
    agreed: !!state.agreed,
    agreedAt: state.agreedAt ?? (state.agreed ? Date.now() : null),
    version: state.version || CONSENT_VERSION,
    userAgent: state.userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : ""),
    purpose: state.purpose || getDefaultPurpose(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(next));
  }
  return next;
}

export function clearConsentState() {
  if (typeof window !== "undefined") {
    window.localStorage.removeItem(CONSENT_KEY);
  }
}
