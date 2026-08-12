package app.gridalive.gridcaller;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.AlarmManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import androidx.core.app.NotificationCompat;

/**
 * Sticky foreground service — keeps GridCaller process alive for mesh
 * so incoming calls can still ring when app is in background.
 */
public class MeshForegroundService extends Service {
    public static final String CHANNEL_MESH = "gridcaller_mesh_keepalive";
    public static final String CHANNEL_CALL = "gridcaller_incoming_call";
    public static final String CHANNEL_MISSED = "gridcaller_missed_call";
    public static final int NOTIF_MESH = 7701;
    public static final int NOTIF_CALL = 7702;
    private static final String PREFS = "mesh_vpn_state";
    private static final String KEY_MODE = "mode";
    private static final String KEY_ONLINE = "online";
    private static final String KEY_STATE = "state";
    private static final String CALL_PREFS = "gridcaller_native_call";
    private static final long CALL_TIMEOUT_MS = 55_000L;

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
        String mode = getMeshVpnMode(this);
        String state = getMeshVpnState(this);
        String title = "GridCaller mesh online";
        String body = "Soft tower mode is active in the background.";
        if (!"disabled".equals(mode)) {
            title = "GridCaller mesh VPN active";
            body = "Gateway/client preview is active for shared internet over the mesh.";
        }

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
            .setContentTitle(title)
            .setContentText(body + " · " + state)
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
        call.setBypassDnd(false);
        Uri ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        call.setSound(ringtone, new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build());
        nm.createNotificationChannel(call);

        NotificationChannel missed = new NotificationChannel(CHANNEL_MISSED, "Missed calls", NotificationManager.IMPORTANCE_DEFAULT);
        missed.setDescription("Missed GridCaller call history");
        missed.enableVibration(false);
        missed.setSound(null, null);
        nm.createNotificationChannel(missed);
    }

    /** Static helper: show full-screen incoming call notification */
    public static void notifyIncomingCall(Context ctx, String fromName, String callId) {
        SharedPreferences existing = ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE);
        if (callId != null && callId.equals(existing.getString("call_id", ""))
            && "INCOMING_RINGING".equals(existing.getString("state", ""))) return;
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
                call.setBypassDnd(false);
                call.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                    new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
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

        Intent acceptIntent = new Intent(ctx, CallNotificationReceiver.class)
            .setAction(CallNotificationReceiver.ACTION_ACCEPT).putExtra("call_id", callId);
        Intent declineIntent = new Intent(ctx, CallNotificationReceiver.class)
            .setAction(CallNotificationReceiver.ACTION_DECLINE).putExtra("call_id", callId);
        PendingIntent accept = PendingIntent.getBroadcast(ctx, 9911, acceptIntent, flags);
        PendingIntent decline = PendingIntent.getBroadcast(ctx, 9912, declineIntent, flags);

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
            .addAction(android.R.drawable.sym_action_call, "ACCEPT", accept)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "DECLINE", decline)
            .setTimeoutAfter(55000);

        boolean fullScreenAllowed = true;
        if (Build.VERSION.SDK_INT >= 34) {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            fullScreenAllowed = manager != null && manager.canUseFullScreenIntent();
        }
        if (fullScreenAllowed) b.setFullScreenIntent(fullScreen, true);

        NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) {
            nm.notify(NOTIF_CALL, b.build());
        }

        ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE).edit()
            .putString("call_id", callId).putString("caller_name", fromName)
            .putString("state", "INCOMING_RINGING").putLong("timestamp", System.currentTimeMillis())
            .putString("pending_action", "").apply();
        scheduleMissedAlarm(ctx, callId);
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

    private static void scheduleMissedAlarm(Context ctx, String callId) {
        Intent timeout = new Intent(ctx, CallNotificationReceiver.class)
            .setAction(CallNotificationReceiver.ACTION_TIMEOUT).putExtra("call_id", callId);
        PendingIntent pending = PendingIntent.getBroadcast(ctx, 9913, timeout,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        AlarmManager alarm = (AlarmManager) ctx.getSystemService(ALARM_SERVICE);
        if (alarm != null) alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,
            System.currentTimeMillis() + CALL_TIMEOUT_MS, pending);
    }

    public static void applyCallAction(Context ctx, String callId, String action) {
        SharedPreferences prefs = ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE);
        if (callId == null || !callId.equals(prefs.getString("call_id", ""))) return;
        String current = prefs.getString("state", "IDLE");
        if (!"INCOMING_RINGING".equals(current)) return;
        String next = "ACCEPT".equals(action) ? "CONNECTING" : "DECLINING";
        prefs.edit().putString("state", next).putString("pending_action", action).apply();
        cancelIncoming(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP)
            .putExtra("incoming_call", true).putExtra("call_id", callId)
            .putExtra("call_from", prefs.getString("caller_name", "GridCaller"))
            .putExtra("call_action", action);
        ctx.startActivity(open);
    }

    public static void markMissed(Context ctx, String callId) {
        SharedPreferences prefs = ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE);
        if (callId == null || !callId.equals(prefs.getString("call_id", "")) ||
            !"INCOMING_RINGING".equals(prefs.getString("state", ""))) return;
        prefs.edit().putString("state", "MISSED").putString("pending_action", "TIMEOUT").apply();
        cancelIncoming(ctx);
        Intent open = new Intent(ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(ctx, 9914, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
            if (manager != null) {
                NotificationChannel channel = new NotificationChannel(CHANNEL_MISSED, "Missed calls", NotificationManager.IMPORTANCE_DEFAULT);
                channel.enableVibration(false);
                channel.setSound(null, null);
                manager.createNotificationChannel(channel);
            }
        }
        Notification missed = new NotificationCompat.Builder(ctx, CHANNEL_MISSED)
            .setSmallIcon(android.R.drawable.stat_notify_missed_call)
            .setContentTitle("Missed GridCaller call")
            .setContentText(prefs.getString("caller_name", "GridCaller"))
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL).setAutoCancel(true)
            .setContentIntent(content).build();
        NotificationManager nm = (NotificationManager) ctx.getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIF_CALL, missed);
    }

    public static String getCallStateJson(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE);
        return "{\"callId\":" + quote(p.getString("call_id", ""))
            + ",\"callerName\":" + quote(p.getString("caller_name", ""))
            + ",\"state\":" + quote(p.getString("state", "IDLE"))
            + ",\"action\":" + quote(p.getString("pending_action", ""))
            + ",\"timestamp\":" + p.getLong("timestamp", 0L) + "}";
    }

    public static void clearPendingAction(Context ctx) {
        ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE).edit().putString("pending_action", "").apply();
    }

    public static void updateCallState(Context ctx, String callId, String state) {
        SharedPreferences p = ctx.getSharedPreferences(CALL_PREFS, Context.MODE_PRIVATE);
        if (callId == null || !callId.equals(p.getString("call_id", ""))) return;
        p.edit().putString("state", state == null ? "ENDED" : state).putString("pending_action", "").apply();
        if (!"INCOMING_RINGING".equals(state)) cancelIncoming(ctx);
    }

    private static String quote(String value) {
        if (value == null) value = "";
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
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
        String state = "idle";
        if ("gateway".equals(resolved)) {
            state = online ? "gateway-ready" : "gateway-waiting";
        } else if ("client".equals(resolved)) {
            state = online ? "client-ready" : "client-waiting";
        }
        sp.edit()
            .putString(KEY_MODE, resolved)
            .putBoolean(KEY_ONLINE, online)
            .putString(KEY_STATE, state)
            .apply();
    }

    public static void stopMeshVpn(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        sp.edit().putString(KEY_MODE, "disabled").putBoolean(KEY_ONLINE, false).putString(KEY_STATE, "stopped").apply();
    }

    public static String getMeshVpnMode(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getString(KEY_MODE, "disabled");
    }

    public static boolean isMeshVpnOnline(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getBoolean(KEY_ONLINE, false);
    }

    public static String getMeshVpnState(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        return sp.getString(KEY_STATE, "stopped");
    }
}
