import Foundation

#if canImport(UIKit)
import UIKit
#endif

public enum KeepAwakeService {
    /// Keeps screen awake (e.g. during full-screen ready alert or student tracking)
    public static func setKeepAwake(_ on: Bool) {
        #if os(iOS)
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
        }
        #endif
    }
}
