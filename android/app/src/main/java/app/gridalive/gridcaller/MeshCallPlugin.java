package app.gridalive.gridcaller;

import android.content.Intent;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "MeshCall")
public class MeshCallPlugin extends Plugin {

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
}
