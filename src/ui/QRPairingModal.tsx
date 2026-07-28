import { useEffect, useMemo, useState } from "react";
import { encodeHandleNodeId, encodeInviteCode, decodeAnyPairingCode, generatePairingQr } from "../mesh/qrPairing";

type PairingEngine = {
  peerId: string;
  addPeerFromCode: (handle: string, nodeId: string) => Promise<boolean>;
};

export function QRPairingModal({
  open,
  onClose,
  handle,
  engine,
}: {
  open: boolean;
  onClose: () => void;
  handle: string;
  engine: PairingEngine;
}) {
  const [qr, setQr] = useState("");
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const token = useMemo(() => encodeHandleNodeId(handle, engine.peerId), [engine.peerId, handle]);
  const inviteCode = useMemo(() => encodeInviteCode(engine.peerId, handle), [engine.peerId, handle]);

  useEffect(() => {
    if (!open) return;
    void generatePairingQr(token).then(setQr).catch(() => setQr(""));
  }, [open, token]);

  if (!open) return null;

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Copied");
    } catch {
      setNote("Copy failed");
    }
  };

  const addPeer = async () => {
    const parsed = decodeAnyPairingCode(input);
    if (!parsed) {
      setNote("Invalid code");
      return;
    }
    if (parsed.nodeId === engine.peerId) {
      setNote("This is your own code");
      return;
    }
    const ok = await engine.addPeerFromCode(parsed.handle, parsed.nodeId);
    setNote(ok ? "Peer added" : "Add failed");
    if (ok) setInput("");
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1200, background: "#000000aa", display: "grid", placeItems: "center" }}>
      <div style={{ width: "min(420px, 92vw)", maxHeight: "90vh", overflow: "auto", borderRadius: 16, background: "#111", color: "#fff", padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <strong>QR Pairing</strong>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", color: "#fff", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 8 }}>Share this QR or invite code to pair directly.</div>
        {qr ? <img src={qr} alt="Pairing QR" style={{ width: "100%", maxWidth: 280, display: "block", margin: "0 auto 12px" }} /> : null}
        <div style={{ display: "grid", gap: 8 }}>
          <button type="button" onClick={() => void copyText(token)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #333", background: "#1a1a1a", color: "#fff" }}>
            Copy Handle@NodeID
          </button>
          <button type="button" onClick={() => void copyText(inviteCode)} style={{ padding: "8px 10px", borderRadius: 10, border: "1px solid #333", background: "#1a1a1a", color: "#fff" }}>
            Copy Invite Code
          </button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste Handle@NodeID or invite code"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid #333", background: "#0b0b0b", color: "#fff" }}
          />
          <button type="button" onClick={() => void addPeer()} style={{ padding: "10px 12px", borderRadius: 10, border: "none", background: "#0a84ff", color: "#fff", fontWeight: 700 }}>
            Add Peer
          </button>
          {note ? <div style={{ fontSize: 12, opacity: 0.9 }}>{note}</div> : null}
        </div>
      </div>
    </div>
  );
}
