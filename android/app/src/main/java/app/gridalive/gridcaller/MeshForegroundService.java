package app.gridalive.gridcaller;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/**
 * Sticky foreground service — keeps GridCaller process alive for mesh
 * so incoming calls can still ring when app is in background.
 */
public class MeshForegroundService extends Service {
    public static final String CHANNEL_MESH = "gridcaller_mesh_keepalive";
    public static final String CHANNEL_CALL = "gridcaller_incoming_call";
    public static final int NOTIF_MESH = 7701;
    public static final int NOTIF_CALL = 7702;
    private static final String PREFS = "mesh_vpn_state";
    private static final String KEY_MODE = "mode";
    private static final String KEY_ONLINE = "online";

    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
        try {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "GridCaller:MeshWake");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire(4 * 60 * 60 * 1000L); // up to 4h chunks; renewed by restart
            }
        } catch (Exception ignored) {
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        ensureChannels();
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_NEW_TASK);
        open.putExtra("mesh_keepalive", true);
        PendingIntent pi = PendingIntent.getActivity(
            this,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification n = new NotificationCompat.Builder(this, CHANNEL_MESH)
            .setContentTitle("GridCaller mesh online")
            .setContentText("Listening for mesh calls — tap to open")
            .setSmallIcon(android.R.drawable.stat_sys_data_bluetooth)
            .setContentIntent(pi)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();

        startForeground(NOTIF_MESH, n);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;

        NotificationChannel mesh = new NotificationChannel(
            CHANNEL_MESH,
            "Mesh keep-alive",
            NotificationManager.IMPORTANCE_LOW
        );
        mesh.setDescription("Keeps GridCaller connected to mesh");
        nm.createNotificationChannel(mesh);

        NotificationChannel call = new NotificationChannel(
            CHANNEL_CALL,
            "Incoming mesh calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        call.setDescription("Ring and full-screen for mesh calls");
        call.enableVibration(true);
        call.setVibrationPattern(new long[] { 0, 500, 200, 500, 200, 500 });
        call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        call.setBypassDnd(true);
        nm.createNotificationChannel(call);
    }

    /** Static helper: show full-screen incoming call notification */
    public static void notifyIncomingCall(Context ctx, String fromName, String callId) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) {
                NotificationChannel call = new NotificationChannel(
                    CHANNEL_CALL,
                    "Incoming mesh calls",
                    NotificationManager.IMPORTANCE_HIGH
                );
                call.enableVibration(true);
                call.setVibrationPattern(new long[] { 0, 500, 200, 500, 200, 500 });
                call.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                nm.createNotificationChannel(call);
            }
        }

        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK
                | Intent.FLAG_ACTIVITY_SINGLE_TOP
                | Intent.FLAG_ACTIVITY_CLEAR_TOP
                | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        );
        open.putExtra("incoming_call", true);
        open.putExtra("call_from", fromName != null ? fromName : "GridCaller");
        open.putExtra("call_id", callId != null ? callId : "");

        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent fullScreen = PendingIntent.getActivity(ctx, 9901, open, flags);
        PendingIntent content = PendingIntent.getActivity(ctx, 9902, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL_CALL)
            .setContentTitle("Incoming GridCaller")
            .setContentText(fromName != null ? fromName : "Mesh call")
            .setSmallIcon(android.R.drawable.stat_sys_phone_call)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOngoing(true)
            .setContentIntent(content)
            .setFullScreenIntent(fullScreen, true)
            .setVibrate(new long[] { 0, 600, 200, 600, 200, 600, 200, 600 })
            .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
            .setTimeoutAfter(55000);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_CALL, b.build());
        }

        // Extra vibration for OEMs that mute notif vibration
        try {
            android.os.Vibrator v = (android.os.Vibrator) ctx.getSystemService(VIBRATOR_SERVICE);
            if (v != null && v.hasVibrator()) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    v.vibrate(android.os.VibrationEffect.createWaveform(
                        new long[] { 0, 500, 200, 500, 200, 500 }, 0));
                } else {
                    v.vibrate(new long[] { 0, 500, 200, 500, 200, 500 }, 0);
                }
            }
        } catch (Exception ignored) {
        }

        // Try bring activity up
        try {
            ctx.startActivity(open);
        } catch (Exception ignored) {
        }
    }

    public static void cancelIncoming(Context ctx) {
        try {
            NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.cancel(NOTIF_CALL);
        } catch (Exception ignored) {
        }
        try {
            android.os.Vibrator v = (android.os.Vibrator) ctx.getSystemService(VIBRATOR_SERVICE);
            if (v != null) v.cancel();
        } catch (Exception ignored) {
        }
    }

    public static void startMeshVpn(Context ctx, String mode, boolean online) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String resolved = "disabled";
        if ("gateway".equalsIgnoreCase(mode) || "client".equalsIgnoreCase(mode)) {
            resolved = mode.toLowerCase();
        }
        if ("gateway".equals(resolved) && !online) {
            resolved = "client";
        }
        sp.edit().putString(KEY_MODE, resolved).putBoolean(KEY_ONLINE, online).apply();
    }

    public static void stopMeshVpn(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putString(KEY_MODE, "disabled").putBoolean(KEY_ONLINE, false).apply();
    }

    public static String getMeshVpnMode(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getString(KEY_MODE, "disabled");
    }

    public static boolean isMeshVpnOnline(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getBoolean(KEY_ONLINE, false);
    }
}
