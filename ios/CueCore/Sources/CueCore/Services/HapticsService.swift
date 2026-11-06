import Foundation

#if canImport(UIKit)
import UIKit
#endif

public enum HapticsService {
    /// Triple pulse pattern matching the web/Capacitor implementation
    public static func buzz() {
        #if os(iOS)
        let generator = UINotificationFeedbackGenerator()
        generator.prepare()
        generator.notificationOccurred(.warning)

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            let gen2 = UIImpactFeedbackGenerator(style: .heavy)
            gen2.impactOccurred()
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            let gen3 = UIImpactFeedbackGenerator(style: .heavy)
            gen3.impactOccurred()
        }
        #endif
    }

    /// Single tap / medium impact for keypad taps and state changes
    public static func impact() {
        #if os(iOS)
        let generator = UIImpactFeedbackGenerator(style: .medium)
        generator.impactOccurred()
        #endif
    }

    /// Light feedback for number input
    public static func light() {
        #if os(iOS)
        let generator = UIImpactFeedbackGenerator(style: .light)
        generator.impactOccurred()
        #endif
    }

    /// Success notification feedback
    public static func success() {
        #if os(iOS)
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
        #endif
    }
}
