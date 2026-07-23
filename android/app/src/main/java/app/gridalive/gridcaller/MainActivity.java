package app.gridalive.gridcaller;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;
import java.util.ArrayList;
import java.util.List;

/**
 * GridCaller MainActivity
 * · Status bar does not overlay WebView (top bar not cut)
 * · Runtime Bluetooth + Wi‑Fi/Nearby + location + mic/camera permissions
 * · Mesh foreground service for background incoming calls
 */
public class MainActivity extends BridgeActivity {
    private static final int REQ_RUNTIME = 4201;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MeshCallPlugin.class);
        super.onCreate(savedInstanceState);
        setupSystemBars();
        requestMeshPermissions();
        startMeshKeepAliveService();
        handleIncomingExtras(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIncomingExtras(intent);
    }

    private void startMeshKeepAliveService() {
        try {
            Intent i = new Intent(this, MeshForegroundService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(i);
            } else {
                startService(i);
            }
        } catch (Exception ignored) {
        }
    }

    private void handleIncomingExtras(Intent intent) {
        if (intent == null) return;
        if (!intent.getBooleanExtra("incoming_call", false)) return;
        // Wake screen for incoming mesh call
        try {
            getWindow().addFlags(
                WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
                    | WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                    | WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
            );
        } catch (Exception ignored) {
        }
        // Notify WebView via bridge event after short delay
        try {
            final String from = intent.getStringExtra("call_from");
            final String callId = intent.getStringExtra("call_id");
            getBridge().getWebView().postDelayed(() -> {
                try {
                    String js =
                        "window.dispatchEvent(new CustomEvent('gc-native-incoming',{detail:{"
                            + "from:" + jsonStr(from) + ","
                            + "callId:" + jsonStr(callId)
                            + "}}));";
                    getBridge().getWebView().evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }, 600);
        } catch (Exception ignored) {
        }
    }

    private static String jsonStr(String s) {
        if (s == null) return "\"\"";
        return "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void setupSystemBars() {
        try {
            Window window = getWindow();
            WindowCompat.setDecorFitsSystemWindows(window, true);
            window.clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            View decor = window.getDecorView();
            WindowInsetsControllerCompat ctrl = WindowCompat.getInsetsController(window, decor);
            if (ctrl != null) {
                ctrl.setAppearanceLightStatusBars(false);
            }
        } catch (Exception ignored) {
        }
    }

    /** Ask for BT / Wi‑Fi nearby / location / media so Connect Bluetooth works on real phones */
    private void requestMeshPermissions() {
        List<String> need = new ArrayList<>();

        // Android 12+ Bluetooth
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            addIfMissing(need, Manifest.permission.BLUETOOTH_CONNECT);
            addIfMissing(need, Manifest.permission.BLUETOOTH_SCAN);
            addIfMissing(need, Manifest.permission.BLUETOOTH_ADVERTISE);
        }

        // Location (BT scan / Wi‑Fi scan on many OEMs)
        addIfMissing(need, Manifest.permission.ACCESS_FINE_LOCATION);
        addIfMissing(need, Manifest.permission.ACCESS_COARSE_LOCATION);

        // Android 13+ nearby Wi‑Fi devices
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            addIfMissing(need, Manifest.permission.NEARBY_WIFI_DEVICES);
            addIfMissing(need, Manifest.permission.POST_NOTIFICATIONS);
            addIfMissing(need, Manifest.permission.READ_MEDIA_AUDIO);
            addIfMissing(need, Manifest.permission.READ_MEDIA_IMAGES);
        }

        // Calls
        addIfMissing(need, Manifest.permission.RECORD_AUDIO);
        addIfMissing(need, Manifest.permission.CAMERA);

        if (need.isEmpty()) return;
        ActivityCompat.requestPermissions(this, need.toArray(new String[0]), REQ_RUNTIME);
    }

    private void addIfMissing(List<String> need, String perm) {
        if (ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED) {
            need.add(perm);
        }
    }
}
