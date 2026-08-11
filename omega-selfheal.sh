#!/data/data/com.termux/files/usr/bin/bash
set -u

ROOT="$(pwd)"
WORK="$HOME/gridcaller-work/.omega"
MODEL="qwen2.5-coder:3b"
mkdir -p "$WORK"

export OLLAMA_HOST="127.0.0.1:11434"

echo "=== GRIDCALLER OMEGA SELF-HEAL ==="

curl -fsS "$OLLAMA_HOST/api/tags" >/dev/null || {
  echo "Ollama is not running."
  exit 1
}

echo "[1] Git safety"
git checkout main
git pull --ff-only origin main

echo "[2] Baseline"
npm install
npm run build >"$WORK/build-before.log" 2>&1 || true
npm test >"$WORK/test-before.log" 2>&1 || true

echo "[3] Source inventory"
find src android .github \
  -type f \
  \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.java' -o -name '*.kt' \) \
  2>/dev/null | sort >"$WORK/files.txt"

echo "[4] Forensic audit"

grep -RniE \
'GLOBAL_CALL_|placeCall|acceptCall|groupCall|startGroupCall|MeshEngine|meshHubConfig|resolveHubHttp|resolveMeshTarget|RTCPeerConnection|onicecandidate|addIceCandidate|getUserMedia|Gun\(|Trystero|PeerJS|Bluetooth|BLE|api/mesh|mesh-ws|localhost|127\.0\.0\.1|192\.168\.|mock|fake|simulation|placeholder' \
src android 2>/dev/null >"$WORK/critical-code.txt" || true

{
echo 'GRIDCALLER OMEGA-∞ REPAIR CONTRACT'

echo
echo 'MISSION: Make GridCaller a genuine sovereign mesh communication system.'

echo
echo 'NON-NEGOTIABLE:'
echo 'No mandatory central server.'
echo 'No mandatory API backend.'
echo 'No Firebase/Supabase/Twilio/Agora.'
echo 'No mandatory cloud signaling.'
echo 'No API token required for basic device-to-device communication.'
echo 'GitHub Pages is static distribution only.'
echo 'Local/native mesh must be primary.'
echo 'Internet-assisted transport may be optional only.'
echo 'No fake/mock/simulation success in production paths.'
echo 'Do not hide failures.'
echo 'Do not hard-code public servers.'

echo
echo 'TRANSPORT PRIORITY:'
echo 'Native/local peer discovery.'
echo 'BLE where supported.'
echo 'Local Wi-Fi/direct LAN.'
echo 'Decentralized/local signaling.'
echo 'WebRTC direct media.'
echo 'Optional Internet fallback.'

echo
echo 'KNOWN AUDIT FINDINGS:'
echo 'GlobalCallEngine is hub-signaled.'
echo 'MeshEngine contains HTTP/WS hub paths.'
echo 'meshHubConfig derives hub from frontend hostname.'
echo 'GitHub Pages can incorrectly become the assumed backend.'
echo 'Real multi-device interoperability was not fully proven.'
echo 'Group calling previously had a primary-recipient failure pattern.'
echo 'Group invitations must reach every selected participant.'
echo 'Each participant requires an independent RTCPeerConnection.'
echo 'Incoming calls must actually ring.'
echo 'Offer/answer must reach the correct peer.'
echo 'ICE must reach the correct call.'
echo 'ICE arriving before remoteDescription must be safely queued.'
echo 'Duplicate and stale calls must be rejected.'
echo 'Peer resolution must be deterministic.'
echo 'Android must not silently depend on localhost.'
echo '192.168.1.8 must never be mandatory.'
echo 'Existing diagnostics must be preserved.'

echo
echo 'SELF HEALING:'
echo 'Detect transport failures.'
echo 'Retry safely.'
echo 'Rediscover peers.'
echo 'Restore subscriptions.'
echo 'Prevent duplicate connections.'
echo 'Preserve queued messages.'
echo 'Recover transient failures.'
echo 'Only report recovery after actual transport evidence.'

echo
echo 'REQUIRED TESTS:'
echo 'peer discovery'
echo 'no-hub mode'
echo '1-to-1 outgoing call'
echo 'incoming call'
echo 'offer/answer'
echo 'ICE-before-answer'
echo 'ICE-after-answer'
echo 'stale call'
echo 'duplicate call'
echo 'group call'
echo 'multiple participants'
echo 'participant failure isolation'
echo 'reconnect'
echo 'GitHub Pages startup'
echo 'Android configuration'
echo 'no fake success'

echo
echo 'PATCH RULES:'
echo 'Inspect existing architecture before changing it.'
echo 'Fix root causes.'
echo 'Prefer minimal patches.'
echo 'Do not rewrite the whole application.'
echo 'Do not invent APIs.'
echo 'Do not add cloud dependencies.'
echo 'Do not remove working functionality.'
echo 'Return ONLY unified diff beginning with diff --git.'
echo 'The diff must be directly usable by git apply.'
echo
echo 'PREVIOUS AUDIT:'
cat MICRO_ATOMIC_AUDIT_REPORT.md 2>/dev/null || true

echo
echo 'BUILD BEFORE:'
cat "$WORK/build-before.log"

echo
echo 'TEST BEFORE:'
cat "$WORK/test-before.log"

echo
echo 'CRITICAL CODE INDEX:'
cat "$WORK/critical-code.txt"

echo
echo 'SOURCE FILES:'
cat "$WORK/files.txt"

} >"$WORK/context.txt"

echo "[5] Autonomous repair rounds"

MAX=10

for ROUND in $(seq 1 "$MAX"); do
  echo
  echo "========== ROUND $ROUND / $MAX =========="

  npm run build >"$WORK/build-$ROUND.log" 2>&1 || true
  npm test >"$WORK/test-$ROUND.log" 2>&1 || true

  {
    cat "$WORK/context.txt"
    echo
    echo 'CURRENT DIFF:'
    git diff
    echo
    echo 'CURRENT BUILD:'
    cat "$WORK/build-$ROUND.log"
    echo
    echo 'CURRENT TESTS:'
    cat "$WORK/test-$ROUND.log"

    echo
    echo 'TARGET FILE CONTENTS:'

    for f in \
      src/GridCaller.tsx \
      src/kernel/mesh.ts \
      src/kernel/meshHubConfig.ts \
      src/kernel/globalCallEngine.ts \
      src/kernel/softTowerHopNet.ts \
      src/kernel/softTowerDiagnostics.ts \
      src/kernel/emergencyMode.ts
    do
      if [ -f "$f" ]; then
        echo
        echo "===== $f ====="
        cat "$f"
      fi
    done
  } >"$WORK/prompt-$ROUND.txt"

  echo "[Ollama] analysing..."

  ollama run "$MODEL" <"$WORK/prompt-$ROUND.txt" \
    >"$WORK/patch-$ROUND.diff" 2>"$WORK/ollama-$ROUND.log" || true

  if ! grep -q '^diff --git ' "$WORK/patch-$ROUND.diff"; then
    echo "[Ollama] No valid patch returned."
    tail -50 "$WORK/ollama-$ROUND.log"
    continue
  fi

  if ! git apply --check "$WORK/patch-$ROUND.diff"; then
    echo "[Patch] invalid; asking Ollama to repair patch."

    {
      echo 'Fix this unified diff so git apply accepts it.'
      echo 'Return ONLY the corrected unified diff.'
      cat "$WORK/patch-$ROUND.diff"
    } | ollama run "$MODEL" >"$WORK/fixed-$ROUND.diff" 2>"$WORK/fixlog-$ROUND.log" || true

    if grep -q '^diff --git ' "$WORK/fixed-$ROUND.diff" &&
       git apply --check "$WORK/fixed-$ROUND.diff"; then
      git apply "$WORK/fixed-$ROUND.diff"
    else
      echo "[Patch] correction failed."
      continue
    fi
  else
    git apply "$WORK/patch-$ROUND.diff"
  fi

  git diff --check || continue

  npm run build >"$WORK/validated-build-$ROUND.log" 2>&1
  BUILD=$?

  npm test >"$WORK/validated-test-$ROUND.log" 2>&1
  TEST=$?

  if [ "$BUILD" -eq 0 ] && [ "$TEST" -eq 0 ]; then

    echo "[Audit] Checking sovereignty."

    grep -RniE \
    'firebase|supabase|twilio|agora|192\.168\.1\.8|resolveHubHttp|DEFAULT_LAN|localhost|127\.0\.0\.1|mock|fake|simulation|placeholder' \
    src android 2>/dev/null >"$WORK/violations-$ROUND.txt" || true

    {
      cat "$WORK/context.txt"
      echo
      echo 'FINAL DIFF:'
      git diff
      echo
      echo 'SOVEREIGNTY SEARCH:'
      cat "$WORK/violations-$ROUND.txt"
      echo
      echo 'BUILD:'
      cat "$WORK/validated-build-$ROUND.log"
      echo
      echo 'TEST:'
      cat "$WORK/validated-test-$ROUND.log"
      echo
      echo 'Answer exactly one of: PASS or FAIL.'
      echo 'PASS only if the sovereign architecture requirements are genuinely satisfied.'
    } | ollama run "$MODEL" >"$WORK/verdict-$ROUND.txt" 2>/dev/null || true

    cat "$WORK/verdict-$ROUND.txt"

    if grep -qE '(^|[^A-Z])PASS([^A-Z]|$)' "$WORK/verdict-$ROUND.txt"; then
      echo
      echo "========== SOVEREIGN VALIDATION PASSED =========="

      git diff --check
      git status
      git diff --stat

      git add -A
      git commit -m "fix: sovereign mesh communication and self-healing runtime" || true
      git push origin main

      echo
      echo "========== GRIDCALLER MAIN PUSHED =========="
      git log -3 --oneline
      exit 0
    fi
  fi

  echo "[Round $ROUND] validation failed; continuing."

done

echo
echo "========== SELF-HEAL LIMIT REACHED =========="
git status
git diff --stat
exit 2
