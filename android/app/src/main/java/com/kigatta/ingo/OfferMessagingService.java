package com.kigatta.ingo;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;

import com.capacitorjs.plugins.pushnotifications.MessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Draws the driver-offer notification with Accept / Decline buttons.
 *
 * Why this exists: an FCM message with a `notification` block is rendered by
 * Android itself while the app runs no code, so buttons cannot be added to it.
 * The sender (supabase/functions/driver-offer-push) therefore sends the Android
 * leg data-only, and this service builds the notification. A high-priority data
 * message starts this service even when the app process is dead, which is what
 * keeps delivery working for a killed app.
 *
 * Subclasses Capacitor's MessagingService and calls through to it, so token
 * refresh and the JS `pushNotificationReceived` event are unchanged. The manifest
 * gives this service a higher intent-filter priority than the plugin's; Firebase
 * delivers each message to exactly one MESSAGING_EVENT service.
 *
 * The buttons do not talk to the backend from here. Each one launches
 * MainActivity with the message's data plus `ingoAction`, and because the extras
 * include `google.message_id`, Capacitor's push plugin surfaces the launch to JS
 * as `pushNotificationActionPerformed`. DriverOffersProvider then runs the same
 * accept / reject functions the in-app offer card uses.
 */
public class OfferMessagingService extends MessagingService {
    private static final String TAG = "IngoOfferPush";

    /** MUST equal DRIVER_OFFER_CHANNEL_ID in src/lib/driverPush.js. See docs/adr/0001. */
    static final String CHANNEL_ID = "ingo_driver_offers";
    static final String CHANNEL_NAME = "Driver offers";

    /** One id for every offer notification; the FCM `tag` (one per order) tells them apart. */
    static final int NOTIFICATION_ID = 0x1960;

    static final String EXTRA_ACTION = "ingoAction";
    static final String ACTION_ACCEPT = "accept";
    static final String ACTION_DECLINE = "decline";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> data = message.getData();
        String type = data.get("type");
        String tag = data.get("tag");
        Log.i(TAG, "message type=" + type + " tag=" + tag + " hasNotificationBlock=" + (message.getNotification() != null));

        if ("offer_ring".equals(type) && tag != null && !tag.isEmpty()) {
            show(message, data, tag);
        } else if ("offer_stop".equals(type) && tag != null && !tag.isEmpty()) {
            manager().cancel(tag, NOTIFICATION_ID);
            Log.i(TAG, "withdrawn tag=" + tag);
        }

        // The JS side still gets the event when the WebView is alive (in-app card,
        // ring, banner). When it is not, this call is a no-op.
        super.onMessageReceived(message);
    }

    private void show(RemoteMessage message, Map<String, String> data, String tag) {
        ensureChannel(this);

        String title = firstNonEmpty(data.get("title"), "New InGo booking");
        String body = firstNonEmpty(data.get("body"), "Open the app to accept or reject.");
        String messageId = message.getMessageId() != null ? message.getMessageId() : String.valueOf(System.currentTimeMillis());

        PendingIntent open = launch(this, data, messageId, tag, null, 0);
        PendingIntent accept = launch(this, data, messageId, tag, ACTION_ACCEPT, 1);
        PendingIntent decline = launch(this, data, messageId, tag, ACTION_DECLINE, 2);

        Notification n = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_offer)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Accept", accept)
            .addAction(0, "Decline", decline)
            .build();

        manager().notify(tag, NOTIFICATION_ID, n);
        Log.i(TAG, "posted tag=" + tag + " title=" + title);
    }

    /**
     * An intent into MainActivity that Capacitor's push plugin will report to JS as a
     * notification tap. `google.message_id` is the key the plugin looks for; every
     * other extra becomes `notification.data`. The Intent action string is unique per
     * (tag, button) so the PendingIntents never collapse into one another.
     */
    private static PendingIntent launch(Context ctx, Map<String, String> data, String messageId, String tag, String action, int slot) {
        Intent i = new Intent(ctx, MainActivity.class);
        i.setAction("com.kigatta.ingo.OFFER_" + slot + "_" + tag);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("google.message_id", messageId);
        for (Map.Entry<String, String> e : data.entrySet()) {
            i.putExtra(e.getKey(), e.getValue());
        }
        if (action != null) i.putExtra(EXTRA_ACTION, action);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(ctx, (tag + "#" + slot).hashCode(), i, flags);
    }

    /** Idempotent. The JS side creates the same channel; whichever runs first wins and the other is a no-op. */
    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) ctx.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm.getNotificationChannel(CHANNEL_ID) != null) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("New delivery and ride requests");
        ch.enableVibration(true);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }

    private NotificationManager manager() {
        return (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private static String firstNonEmpty(String a, String b) {
        return (a != null && !a.trim().isEmpty()) ? a : b;
    }
}
