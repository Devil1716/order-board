package in.sharan.orderboard;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CueWatchPlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Foreground = resumed (visible and screen on). Pause covers home, recents and screen-off. */
    @Override
    public void onResume() {
        super.onResume();
        WatchState.foreground = true;
    }

    @Override
    public void onPause() {
        WatchState.foreground = false;
        super.onPause();
    }
}
