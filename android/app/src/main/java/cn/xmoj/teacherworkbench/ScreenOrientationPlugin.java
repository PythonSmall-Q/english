package cn.xmoj.teacherworkbench;

import android.app.Activity;
import android.content.pm.ActivityInfo;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 原生屏幕方向锁定插件。
 *
 * WebView 内的 `screen.orientation.lock()` 只有在页面处于全屏（Fullscreen API）
 * 状态时才会生效，普通 Activity 下调用会被静默拒绝，这也是“设置页横竖屏切换无效”的根因。
 * 这里通过 Activity.setRequestedOrientation() 在原生层直接锁定方向，JS 侧通过
 * window.Capacitor.Plugins.ScreenOrientation 调用。
 */
@CapacitorPlugin(name = "ScreenOrientation")
public class ScreenOrientationPlugin extends Plugin {

    @PluginMethod
    public void setOrientation(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity not available");
            return;
        }

        String orientation = call.getString("orientation", "unspecified");
        final int mode;
        if ("portrait".equals(orientation)) {
            mode = ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT;
        } else if ("landscape".equals(orientation)) {
            mode = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE;
        } else {
            mode = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        }

        activity.runOnUiThread(() -> activity.setRequestedOrientation(mode));
        call.resolve();
    }

    @PluginMethod
    public void getOrientation(PluginCall call) {
        Activity activity = getActivity();
        JSObject ret = new JSObject();
        ret.put("requestedOrientation", activity == null ? ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED : activity.getRequestedOrientation());
        call.resolve(ret);
    }
}
