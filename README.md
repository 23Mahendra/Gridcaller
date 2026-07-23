# GridCaller standalone = **GridAlive GridCaller UI + stack**

**Folder:** `D:\gridcaller`

## Rule
**No new custom caller UI.**  
UI + engines are **copied from GridAlive**:

| File | From GridAlive |
|------|----------------|
| `src/GridCaller.tsx` | GridCaller (iOS-class phone UI) |
| `src/kernel/*` | mesh, meshCommsEngine, globalCall, contactsVault, … |
| Hub `/mesh-ws` + `/api/mesh/*` | Same mesh protocol as GridAlive server |

`App.tsx` only mounts `<GridCaller />`.

## Run
```bat
cd /d D:\gridcaller
npm install
npm run build
npm run hub
```
Open: http://PC-IP:8765

## APK
```bat
npm run cap:sync
npx cap open android
```

## Update from GridAlive
Re-copy sources when GridAlive GridCaller changes:
```bat
copy D:\GridAlive\src\GridCaller.tsx D:\gridcaller\src\
xcopy /Y /I D:\GridAlive\src\kernel D:\gridcaller\src\kernel
```
Then `npm run build`.
