# Hamburger menu audit

## 1. Global navigation shell
- Menu entry point: the hamburger overlay in src/GridCaller.tsx.
- State used: `menuOpen`, `menuView`.
- Navigation model: local in-app navigation only. There is no URL router; each category is a view state.
- Back/close behavior: the top-left button closes the overlay from the home view and returns to home from any sub-view.
- Input: tap the hamburger button.
- Output: opens the overlay and switches to one of the sub-views.
- Dependencies: React state, token styling, existing app state such as peers, device count, privacy mode, and hub status.
- Audit status: complete and self-contained at the UI layer.

## 2. Home / menu index
- View id: `home`.
- Clickable items:
  1. Share app
  2. Privacy
  3. Devices
  4. Network
  5. Profile
  6. Radio
  7. Map
  8. Settings
- Workflow:
  1. User taps a card/button.
  2. The app preloads relevant state for that category when needed.
  3. `menuView` changes to the chosen category.
- Inputs: tap event, current app state.
- Outputs: navigation to the selected category view.
- Dependencies: `listConnectedDevices`, `isPrivacyMode()`, `loadMyCard()`, `getPrimaryApk()`, storage values.
- Audit status: complete.

## 3. Share app
- View id: `share`.
- Clickables:
  1. Share APK (Bluetooth / any app)
  2. Share via Wi-Fi (link)
  3. WhatsApp
  4. Download APK
  5. Refresh APK list
- Workflow:
  1. The view shows the hub URL and current APK metadata.
  2. Each action calls a dedicated helper.
  3. The result is displayed in `shareMsg` and optionally updates `apkInfo`.
- Inputs: current hub URL, APK files, share APIs, local device support.
- Outputs: share message, APK metadata, link, and device list summary.
- Functions involved: `shareAppViaSystem()`, `shareAppWifiLink()`, `shareAppWhatsApp()`, `downloadApkNow()`, `getPrimaryApk()`, `listApkFiles()`.
- Dependencies: share app utilities, local file system, browser/device sharing support, hub HTTP address.
- Audit status: wired and resilient with fallback messaging.

## 4. Privacy
- View id: `privacy`.
- Clickables:
  1. Turn privacy on/off
  2. New radio ID
- Workflow:
  1. The current privacy status is shown.
  2. The toggle calls `setPrivacyMode(next, myName)` and updates the local privacy state.
  3. The radio ID is rotated via the free-radio module.
- Inputs: current privacy flag, current user name.
- Outputs: updated privacy flag and status message.
- Functions involved: `isPrivacyMode()`, `getPrivacyStatus()`, `setPrivacyMode()`, `freeRadio.rotateRadioId()`.
- Dependencies: privacy module, free radio module, mesh state.
- Audit status: complete. It is self-contained and state-driven.

## 5. Devices
- View id: `devices`.
- Clickables:
  1. BT accessory (optional)
  2. Save and connect Wi-Fi
  3. Use saved Wi-Fi entry
  4. Remove saved Wi-Fi entry
  5. Remove saved Bluetooth entry
  6. Refresh
- Workflow:
  1. Device status is computed from online devices, network strength, hub connectivity, and saved Wi-Fi/Bluetooth entries.
  2. User can link Bluetooth, save Wi-Fi, and refresh network handshakes.
  3. The UI updates messages and the tower tick counter.
- Inputs: Bluetooth permission, Wi-Fi credentials, current network state, mesh peer list.
- Outputs: device status summary, connection messages, refreshed strength score, saved network links.
- Functions involved: `connectBluetoothWithPermission()`, `connectWifiWithPassword()`, `removeBt()`, `removeWifi()`, `networkStrengthReport()`, `getDevicePanelStatus()`, `softTowerHop.start()`, `freeMeshFabric.start()`.
- Dependencies: device connection helpers, network strength helper, mesh transport helpers.
- Audit status: complete with explicit fallback messaging.

## 6. Network / tower
- View id: `tower`.
- Clickables:
  1. Call nearby peer
  2. Message nearby peer
  3. Save nearby peer
  4. Refresh connections
- Workflow:
  1. The view reads the soft-tower network health and free-mesh stats.
  2. Nearby peer cards are shown.
  3. Actions either place a call, open a thread, save the peer, or refresh the mesh handshake.
- Inputs: soft-tower peer list, free-mesh stats, selected peer.
- Outputs: network health card, peer actions, updated connection state.
- Functions involved: `softTowerHop.getNetworkHealth()`, `freeMeshFabric.getStats()`, `softTowerHop.getPeers()`, `placeCall()`, `setThread()`, `saveGridNumberToDevice()`, `softTowerHop.start()`, `freeMeshFabric.start()`.
- Dependencies: soft-tower network layer, free mesh fabric, mesh calling logic, storage.
- Audit status: complete.

## 7. Profile / identity card
- View id: `profile`.
- Clickables:
  1. Add / change photo
  2. Save my card
  3. Share on Grid network
  4. Share on WhatsApp
  5. Share anywhere (BT / apps / copy)
  6. Save received card
  7. Clear received cards
- Workflow:
  1. The profile card is loaded from storage.
  2. User edits fields and saves them.
  3. Card content can be shared to the mesh or other channels.
  4. Received cards are listed and can be saved into contacts.
- Inputs: profile form values, photo file, incoming card data.
- Outputs: saved profile card, contact entries, share results, inbox state.
- Functions involved: `loadMyCard()`, `saveMyCard()`, `compressImageFile()`, `shareCardOnGridNetwork()`, `shareCardWhatsApp()`, `shareCardAnywhere()`, `clearInbox()`, `contactsVault.upsert()`, `refreshContacts()`.
- Dependencies: profile-card module, contacts vault, image compression, sharing helpers.
- Audit status: complete.

## 8. Radio
- View id: `radio`.
- Clickables:
  1. Join channel
  2. New ID
  3. Radio on/off
  4. Send message
  5. Hold to talk
- Workflow:
  1. User enters a channel and optional password.
  2. The app joins the radio session and enables the module.
  3. Messages are sent through the free-radio transport.
  4. PTT uses microphone access and stops on release.
- Inputs: channel name, secret, text message, microphone permission.
- Outputs: joined radio channel, peer list, messages, PTT audio stream.
- Functions involved: `freeRadio.setChannel()`, `freeRadio.enable()`, `freeRadio.setOperatorName()`, `freeRadio.rotateRadioId()`, `freeRadio.sendText()`, `freeRadio.pttStart()`, `freeRadio.pttStop()`.
- Dependencies: free-radio module, browser microphone, storage.
- Audit status: complete, pending only on microphone permission and runtime support.

## 9. Map
- View id: `map`.
- Clickables:
  1. Save number
  2. Call peer
  3. Block peer
- Workflow:
  1. The map loads when the view opens.
  2. The app requests location permission if needed and shows the current GPS position.
  3. Nearby peer positions are rendered on the Leaflet map.
  4. Peer actions save, call, or block the selected user.
- Inputs: GPS location, peer location data, map container DOM.
- Outputs: interactive map, peer cards, action results.
- Functions involved: `setAutoMeshGps()`, `onPeerLocation`, `saveGridNumberToDevice()`, `placeCall()`, `blockCaller()`.
- Dependencies: Leaflet, geolocation, auto-mesh peer state, storage.
- Audit status: complete, dependent on device location permission availability.

## 10. Settings
- View id: `settings`.
- Clickables:
  1. Toggle dark/light mode
  2. Turn GridCaller off
  3. Save name / ID / phone / display number
  4. Random ID
  5. Save handle
  6. Check mobile call
  7. Local only toggle
  8. Call type selector
  9. Refresh bridge status
- Workflow:
  1. The profile fields are prefilled from storage.
  2. Saving updates the visible identity and global handle.
  3. The app updates mesh identity, global call handle, and related storage values.
  4. Bridge status is probed through the GitHub helper.
- Inputs: identity fields, app mode, call scope, handle, phone.
- Outputs: saved user identity, updated home display number, updated bridge status message.
- Functions involved: `applyProfileSave()`, `applyHandleSave()`, `setForceLocalMesh()`, `setCallScope()`, `ghStatus()`, `pstnBridge.getStatus()`.
- Dependencies: storage, mesh identity, global call engine, PSTN bridge, GitHub status helper.
- Audit status: complete and now surfaces the mesh handle / peer ID clearly.

## Cross-check summary
- Navigation is local and consistent through the `menuView` state.
- Every category has its own input form or action set.
- Each category writes to either local React state, storage, or a network/helper module.
- The app is now structured so each hamburger category can be reviewed independently and audited by a maintainer.
- The remaining external requirements are runtime dependencies such as microphone permission, location permission, Wi-Fi/Bluetooth support, and a local hub being available for full mesh/bridge behavior.
