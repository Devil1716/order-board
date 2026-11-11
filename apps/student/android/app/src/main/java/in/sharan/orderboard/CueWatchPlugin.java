package in.sharan.orderboard;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/** Bridge between the Cue web UI and the background order watcher. */
@CapacitorPlugin(name = "CueWatch")
public class CueWatchPlugin extends Plugin {

    /**
     * sync({ projectId, apiKey, tokens:[n], acked:{n:readyMs} }).
     * Starts the watcher while there are tracked tokens, stops it when there are none.
     */
    @PluginMethod
    public void sync(PluginCall call) {
        Context c = getContext().getApplicationContext();
        JSArray tokens = call.getArray("tokens", new JSArray());
        JSObject acked = call.getObject("acked", new JSObject());
        String projectId = call.getString("projectId", "");
        String apiKey = call.getString("apiKey", "");
        WatchState.setConfig(c, projectId, apiKey, tokens, acked);

        // Anything the student already acknowledged in-app must not stay in the shade.
        try {
            JSONArray names = acked.names();
            if (names != null) for (int i = 0; i < names.length(); i++) {
                String k = names.getString(i);
                JSONObject n = WatchState.getMap(c, "notified");
                if (n.has(k) && n.optLong(k) == acked.optLong(k)) OrderWatchService.cancelReady(c, Integer.parseInt(k));
            }
        } catch (Exception ignored) {}

        boolean start = tokens.length() > 0 && !projectId.isEmpty();
        Intent svc = new Intent(c, OrderWatchService.class);
        JSObject res = new JSObject();
        if (start) {
            try {
                if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(svc); else c.startService(svc);
                res.put("running", true);
            } catch (Exception e) {
                res.put("running", false);
                res.put("error", String.valueOf(e));
            }
        } else {
            c.stopService(svc);
            res.put("running", false);
        }
        call.resolve(res);
    }

    @PluginMethod
    public void clear(PluginCall call) {
        Integer token = call.getInt("token");
        if (token != null) OrderWatchService.cancelReady(getContext(), token);
        call.resolve();
    }

    /** The app is on screen again: ready orders are shown in-app, so remove their notifications. */
    @PluginMethod
    public void clearAll(PluginCall call) {
        Context c = getContext().getApplicationContext();
        JSONArray t = WatchState.tokens(c);
        for (int i = 0; i < t.length(); i++) {
            try { OrderWatchService.cancelReady(c, t.getInt(i)); } catch (Exception ignored) {}
        }
        call.resolve();
    }

    @PluginMethod
    public void batteryStatus(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject r = new JSObject();
        r.put("unrestricted", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(r);
    }

    /** One-tap "allow Cue to run in the background" dialog (falls back to the settings list). */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:" + getContext().getPackageName()));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        } catch (Exception e) {
            Intent i = new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
        }
        call.resolve();
    }
}
