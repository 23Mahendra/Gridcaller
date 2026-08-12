package app.gridalive.gridcaller;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class CallNotificationReceiver extends BroadcastReceiver {
    public static final String ACTION_ACCEPT = "app.gridalive.gridcaller.CALL_ACCEPT";
    public static final String ACTION_DECLINE = "app.gridalive.gridcaller.CALL_DECLINE";
    public static final String ACTION_TIMEOUT = "app.gridalive.gridcaller.CALL_TIMEOUT";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String callId = intent.getStringExtra("call_id");
        String action = intent.getAction();
        if (ACTION_TIMEOUT.equals(action)) {
            MeshForegroundService.markMissed(context, callId);
            return;
        }
        if (ACTION_DECLINE.equals(action)) {
            MeshForegroundService.applyCallAction(context, callId, "DECLINE");
            return;
        }
        if (ACTION_ACCEPT.equals(action)) {
            MeshForegroundService.applyCallAction(context, callId, "ACCEPT");
        }
    }
}
