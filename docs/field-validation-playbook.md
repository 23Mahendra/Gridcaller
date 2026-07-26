# Field Validation Playbook

This playbook turns the remaining "test on real devices" gap into a repeatable release gate.

## Release gate

Run this before calling a build production-ready:

1. `npm run test:release`
2. Build/copy APK on the hub PC: `npm run apk:copy`
3. Test with at least 3 real devices on the same Wi-Fi or hotspot
4. Capture pass/fail evidence for each flow below

## Device matrix

- Device A: hub host or same-LAN controller
- Device B: Android phone on the same Wi-Fi
- Device C: second Android phone, ideally different vendor/network state

## Required flows

Mark each step with timestamp and result.

- APK share: Device B and C can open the share screen, receive the APK link, and download/install successfully.
- Auto-join: each device appears in the others' peer lists without a manual connect step.
- Global call: A can dial B by handle or number, B can answer, and two-way audio works.
- Soft tower relay: A can resolve B by Grid Number or SIM alias while B is online.
- Privacy mode: turning privacy on forces local-only behavior; turning it off restores prior radio/mesh state.
- Free radio: text and push-to-talk packets move between at least two devices on the same channel.
- Disaster broadcast: SOS or emergency broadcast is received by at least one other device.

## Evidence log template

Use one line per check:

`[time] flow | devices | expected | actual | pass/fail | notes`

Example:

`[19:42] global-call | A->B | B rings and audio connects | ring in 2s, audio both ways | pass | Wi-Fi only`

## Stop-ship conditions

- APK share shows an unverified or broken hub URL on the release network
- Auto-join fails on a clean install after permissions are granted
- Dial/resolve works only by raw peer id and not by handle/number
- Privacy mode leaves radio or cloud flags in the wrong state after exit
- Any device crashes or loses call audio during the validation run
