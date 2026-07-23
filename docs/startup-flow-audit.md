# Startup and runtime flow audit

## 1. App bootstrap
- Entry point: src/App.tsx.
- On startup it performs the following in order:
  1. Installs viewport fit and native chrome behavior.
  2. Ensures the hub defaults exist.
  3. Ensures the local mesh identity exists.
  4. Unifies local identity with the rest of the mesh modules.
  5. Starts the mesh keep-alive, auto-join, auto-mesh, resilient mesh, and OTA watcher.
  6. Requests native permissions and re-runs auto-join once permissions are available.

## 2. Identity flow
- Identity bootstrap uses src/mesh/identity.ts.
- The app persists a stable peer id and mesh handle so the device can present itself as a real mesh identity without needing a SIM or manual setup.
- The identity state is then reused by the main UI, the auto-mesh engine, and the global call path.

## 3. Auto-join / discovery flow
- Auto-join is started from src/App.tsx and from the main GridCaller shell.
- The workflow is designed to work with Wi-Fi mesh, swarm, and Bluetooth proximity without requiring a manual connect step.
- The UI is expected to surface this through the app status note and the menu-based network/connection views.

## 4. Mesh and bridge dependencies
- The app’s main networking and transport stack depends on the hub configuration, mesh engine, auto-mesh, and resilient mesh helpers.
- The bridge status shown in the menu is a UI-facing readout of the local hub / GitHub bridge availability.
- If the hub is unavailable, the app degrades gracefully and displays the offline state instead of failing silently.

## 5. Production-readiness notes
- The startup path is centralized and self-contained enough for auditing.
- The main visible flows are now backed by explicit state and clearer fallback messaging.
- The remaining external dependencies are runtime permissions and the presence of the local hub / nearby peers.
