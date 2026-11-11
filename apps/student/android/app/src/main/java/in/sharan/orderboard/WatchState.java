package in.sharan.orderboard;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * State shared by the web layer (via CueWatchPlugin), MainActivity and OrderWatchService.
 * Persisted in SharedPreferences so the service keeps working after the app is swiped away.
 */
final class WatchState {
    private static final String PREFS = "cue_watch";

    /** True only while MainActivity is resumed (visible, screen on). Updated from the activity. */
    static volatile boolean foreground = false;

    private WatchState() {}

    static SharedPreferences prefs(Context c) {
        return c.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized JSONObject getMap(Context c, String key) {
        try {
            return new JSONObject(prefs(c).getString(key, "{}"));
        } catch (JSONException e) {
            return new JSONObject();
        }
    }

    static synchronized void putMap(Context c, String key, JSONObject o) {
        prefs(c).edit().putString(key, o.toString()).apply();
    }

    static synchronized void setConfig(Context c, String projectId, String apiKey, JSONArray tokens, JSONObject acked) {
        long now = System.currentTimeMillis();
        JSONObject since = getMap(c, "since");
        JSONObject notified = getMap(c, "notified");
        JSONObject nextSince = new JSONObject();
        JSONObject nextNotified = new JSONObject();
        try {
            for (int i = 0; i < tokens.length(); i++) {
                String k = String.valueOf(tokens.getInt(i));
                nextSince.put(k, since.optLong(k, now));
                if (notified.has(k)) nextNotified.put(k, notified.getLong(k));
            }
        } catch (JSONException ignored) {}
        prefs(c).edit()
                .putString("projectId", projectId)
                .putString("apiKey", apiKey)
                .putString("tokens", tokens.toString())
                .putString("acked", acked.toString())
                .putString("since", nextSince.toString())
                .putString("notified", nextNotified.toString())
                .apply();
    }

    static synchronized JSONArray tokens(Context c) {
        try {
            return new JSONArray(prefs(c).getString("tokens", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }
}
