import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { installViewportFit } from "./lib/viewportFit";

type EBState = { error: Error | null };

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, EBState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error): EBState {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          minHeight: "100dvh", display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
          background: "#05070b", color: "#f5f7fa", padding: 24, fontFamily: "system-ui,sans-serif",
        }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>GridCaller failed to start</h2>
          <p style={{ margin: "0 0 16px", color: "#94a3b8", fontSize: 14, textAlign: "center", maxWidth: 360 }}>
            {this.state.error.message || String(this.state.error)}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              border: "none", borderRadius: 999, padding: "10px 24px",
              background: "#0a84ff", color: "#fff", fontWeight: 700, fontSize: 15, cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Lock height to real visible screen before first paint
installViewportFit();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
