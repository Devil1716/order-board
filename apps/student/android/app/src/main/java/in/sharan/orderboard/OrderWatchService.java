package in.sharan.orderboard;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;

/**
 * Keeps watching the tracked tokens (public Firestore REST reads, no paid backend) while the
 * student has an active order, even after the app is swiped away, and posts one normal
 * heads-up notification per "ready" transition when the app is not on screen.
 * Stops itself as soon as nothing is left to watch.
 *
 * Decision rules mirror shared/js/notify-rules.js (unit-tested there).
 */
public class OrderWatchService extends Service {
    static final String TAG = "CueWatch";
    static final String CH_WATCH = "cue_watch";
    static final String CH_READY = "cue_ready_v2";
    static final int ID_WATCH = 1;
    static final int ID_READY_BASE = 2000;
    private static final long POLL_MS = 8000;
    private static final long EXPIRY_MS = 20 * 60000L;
    private static final long STALE_MS = 4 * 3600000L;

    private volatile boolean running = false;
    private Thread loop;
    private PowerManager.WakeLock wake;

    static volatile boolean alive = false;

    @Override public IBinder onBind(Intent i) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannels(this);
        Notification n = watchNotification(this, "Watching your order — we'll alert you when it's ready");
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(this, ID_WATCH, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(ID_WATCH, n);
            }
        } catch (Exception e) {
            Log.w(TAG, "startForeground refused: " + e);
            stopSelf();
            return START_NOT_STICKY;
        }
        alive = true;
        if (!running) {
            running = true;
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "cue:watch");
                wake.acquire(STALE_MS);
            } catch (Exception ignored) {}
            loop = new Thread(this::run, "cue-watch");
            loop.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        alive = false;
        if (loop != null) loop.interrupt();
        try { if (wake != null && wake.isHeld()) wake.release(); } catch (Exception ignored) {}
        super.onDestroy();
    }

    private void run() {
        while (running) {
            boolean anyActive = true;
            try {
                anyActive = pollOnce();
            } catch (Exception e) {
                Log.w(TAG, "poll failed: " + e);
            }
            if (!anyActive) {
                Log.i(TAG, "nothing left to watch, stopping");
                stopForeground(true);
                stopSelf();
                return;
            }
            try { Thread.sleep(POLL_MS); } catch (InterruptedException e) { return; }
        }
    }

    /** @return true while at least one tracked token is still worth watching. */
    private boolean pollOnce() throws Exception {
        Context c = getApplicationContext();
        JSONArray tokens = WatchState.tokens(c);
        String projectId = WatchState.prefs(c).getString("projectId", "");
        String apiKey = WatchState.prefs(c).getString("apiKey", "");
        if (tokens.length() == 0 || projectId.isEmpty()) return false;

        JSONObject acked = WatchState.getMap(c, "acked");
        JSONObject since = WatchState.getMap(c, "since");
        long now = System.currentTimeMillis();
        boolean anyActive = false;
        int waiting = 0, ready = 0;

        for (int i = 0; i < tokens.length(); i++) {
            int n = tokens.getInt(i);
            String k = String.valueOf(n);
            JSONObject doc;
            try {
                doc = fetch(projectId, apiKey, n);
            } catch (Exception netErr) {
                anyActive = true;            // offline for a moment: keep watching
                continue;
            }
            long t = 0, r = 0, col = 0;
            boolean exists = doc != null;
            if (exists) {
                JSONObject f = doc.optJSONObject("fields");
                t = intField(f, "t"); r = intField(f, "r"); col = intField(f, "c");
            }
            long ackedR = acked.optLong(k, -1);
            boolean active;
            boolean isReady = exists && r > 0 && col == 0 && now - t <= STALE_MS && now - r <= EXPIRY_MS;
            if (!exists) {
                active = now - since.optLong(k, now) <= STALE_MS;   // staff may not have added it yet
                if (active) waiting++;
            } else if (col != 0 || now - t > STALE_MS) {
                active = false;
            } else if (r == 0) {
                active = true; waiting++;
            } else {
                active = now - r <= EXPIRY_MS;
            }

            if (!isReady || ackedR == r) {
                // collected / expired / already acknowledged in the app: drop any posted notification
                cancelReady(c, n);
            } else {
                ready++;
                long notifiedR = WatchState.getMap(c, "notified").optLong(k, -1);
                // Foreground => the web layer shows the full-screen alert. Otherwise: one notification.
                if (!WatchState.foreground && notifiedR != r) {
                    postReady(c, n);
                    JSONObject nm = WatchState.getMap(c, "notified");
                    nm.put(k, r);
                    WatchState.putMap(c, "notified", nm);
                }
            }
            // An acknowledged ready order needs no more watching either.
            if (active && !(isReady && ackedR == r)) anyActive = true;
        }
        if (anyActive) {
            String msg = ready > 0 ? "Your order is ready — collect it at the counter"
                    : waiting > 1 ? "Watching " + waiting + " orders — we'll alert you when ready"
                    : "Watching your order — we'll alert you when it's ready";
            NotificationManager nmgr = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
            nmgr.notify(ID_WATCH, watchNotification(c, msg));
        }
        return anyActive;
    }

    private static long intField(JSONObject fields, String name) {
        if (fields == null) return 0;
        JSONObject v = fields.optJSONObject(name);
        if (v == null) return 0;
        if (v.has("integerValue")) return Long.parseLong(v.optString("integerValue", "0"));
        if (v.has("doubleValue")) return (long) v.optDouble("doubleValue", 0);
        return 0;
    }

    /** @return the Firestore document, or null if it does not exist (404). */
    private static JSONObject fetch(String projectId, String apiKey, int n) throws Exception {
        URL url = new URL("https://firestore.googleapis.com/v1/projects/" + projectId
                + "/databases/(default)/documents/orders/" + n + "?key=" + apiKey);
        HttpURLConnection h = (HttpURLConnection) url.openConnection();
        h.setConnectTimeout(8000);
        h.setReadTimeout(8000);
        try {
            int code = h.getResponseCode();
            if (code == 404) return null;
            if (code != 200) throw new Exception("HTTP " + code);
            BufferedReader br = new BufferedReader(new InputStreamReader(h.getInputStream(), "UTF-8"));
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = br.readLine()) != null) sb.append(line);
            return new JSONObject(sb.toString());
        } finally {
            h.disconnect();
        }
    }

    // ---- notifications -------------------------------------------------------------------

    static void createChannels(Context c) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        NotificationChannel watch = new NotificationChannel(CH_WATCH, "Order tracking", NotificationManager.IMPORTANCE_LOW);
        watch.setDescription("Shown while Cue is watching your order in the background");
        watch.setShowBadge(false);
        nm.createNotificationChannel(watch);

        NotificationChannel ready = new NotificationChannel(CH_READY, "Order ready", NotificationManager.IMPORTANCE_HIGH);
        ready.setDescription("Alerts you when your order is ready to collect");
        Uri sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        ready.setSound(sound, new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
        ready.enableVibration(true);
        ready.setVibrationPattern(new long[]{0, 400, 150, 400, 150, 400});
        ready.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ready);
    }

    private static PendingIntent openApp(Context c, int token) {
        Intent i = new Intent(c, MainActivity.class);
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        i.putExtra("token", token);
        return PendingIntent.getActivity(c, token, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static Notification watchNotification(Context c, String text) {
        return new NotificationCompat.Builder(c, CH_WATCH)
                .setSmallIcon(R.drawable.ic_stat_cue)
                .setContentTitle("Cue")
                .setContentText(text)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setContentIntent(openApp(c, 0))
                .build();
    }

    /** A normal heads-up notification. Deliberately no fullScreenIntent: it never takes over the screen. */
    static void postReady(Context c, int token) {
        createChannels(c);
        Notification n = new NotificationCompat.Builder(c, CH_READY)
                .setSmallIcon(R.drawable.ic_stat_cue)
                .setColor(0xFFE60023)
                .setContentTitle("Your order is ready")
                .setContentText("Token " + token + " — please collect it from the counter.")
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_MESSAGE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_SOUND | NotificationCompat.DEFAULT_VIBRATE)
                .setAutoCancel(true)
                .setContentIntent(openApp(c, token))
                .build();
        try {
            NotificationManagerCompat.from(c).notify(ID_READY_BASE + token, n);
        } catch (SecurityException denied) {
            Log.w(TAG, "notification permission not granted");
        }
    }

    static void cancelReady(Context c, int token) {
        NotificationManagerCompat.from(c).cancel(ID_READY_BASE + token);
    }
}
