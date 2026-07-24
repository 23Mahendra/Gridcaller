package app.gridalive.gridcaller;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.gridcaller.mesh.GridCallerMeshEngine;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import kotlin.Unit;

@CapacitorPlugin(name = "MeshCall")
public class MeshCallPlugin extends Plugin {
    private static GridCallerMeshEngine meshEngine;

    private GridCallerMeshEngine getMeshEngine() {
        if (meshEngine == null) {
            Context context = getContext().getApplicationContext();
            meshEngine = new GridCallerMeshEngine(context, "android-native");
            meshEngine.configurePacketHandler(bytes -> {
                JSObject payload = new JSObject();
                payload.put("senderId", "android-native");
                payload.put("payloadBase64", Base64.getEncoder().encodeToString(bytes));
                notifyListeners("meshPacket", payload);
                return Unit.INSTANCE;
            });
        }
        return meshEngine;
    }

    @PluginMethod
    public void startKeepAlive(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), MeshForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                getContext().startForegroundService(i);
            } else {
                getContext().startService(i);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stopKeepAlive(PluginCall call) {
        try {
            Intent i = new Intent(getContext(), MeshForegroundService.class);
            getContext().stopService(i);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void showIncomingCall(PluginCall call) {
        try {
            String name = call.getString("name", "GridCaller");
            String callId = call.getString("callId", "");
            MeshForegroundService.notifyIncomingCall(getContext(), name, callId);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void cancelIncomingCall(PluginCall call) {
        try {
            MeshForegroundService.cancelIncoming(getContext());
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void reportMeshRuntime(PluginCall call) {
        try {
            String event = call.getString("event", "mesh");
            JSObject payload = call.getObject("payload");
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("event", event);
            if (payload != null) {
                ret.put("payload", payload);
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void startMeshVpn(PluginCall call) {
        try {
            String mode = call.getString("mode", "gateway");
            boolean online = call.getBoolean("online", true);
            MeshForegroundService.startMeshVpn(getContext(), mode, online);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("mode", MeshForegroundService.getMeshVpnMode(getContext()));
            ret.put("online", MeshForegroundService.isMeshVpnOnline(getContext()));
            ret.put("state", MeshForegroundService.getMeshVpnState(getContext()));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stopMeshVpn(PluginCall call) {
        try {
            MeshForegroundService.stopMeshVpn(getContext());
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void getMeshVpnStatus(PluginCall call) {
        try {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("mode", MeshForegroundService.getMeshVpnMode(getContext()));
            ret.put("online", MeshForegroundService.isMeshVpnOnline(getContext()));
            ret.put("state", MeshForegroundService.getMeshVpnState(getContext()));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void startMeshEngine(PluginCall call) {
        try {
            getMeshEngine().startEngine();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void stopMeshEngine(PluginCall call) {
        try {
            getMeshEngine().stopEngine();
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void broadcastMeshPacket(PluginCall call) {
        try {
            byte[] payload = extractPayload(call);
            getMeshEngine().broadcastPacket(payload);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void sendMeshPacket(PluginCall call) {
        try {
            String recipientId = call.getString("recipientId", "");
            byte[] payload = extractPayload(call);
            getMeshEngine().sendPacket(recipientId, payload);
            JSObject ret = new JSObject();
            ret.put("ok", true);
            ret.put("recipientId", recipientId);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private byte[] extractPayload(PluginCall call) {
        String payload = call.getString("payload", null);
        if (payload != null) {
            return payload.getBytes(StandardCharsets.UTF_8);
        }
        String payloadBase64 = call.getString("payloadBase64", null);
        if (payloadBase64 != null) {
            return Base64.getDecoder().decode(payloadBase64);
        }
        return new byte[0];
    }
}
