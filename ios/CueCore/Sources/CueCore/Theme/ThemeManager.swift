import SwiftUI
import Combine

public enum ThemeMode: String, CaseIterable, Codable {
    case system = "system"
    case light = "light"
    case dark = "dark"

    public var title: String {
        switch self {
        case .system: return "Auto"
        case .light: return "Light"
        case .dark: return "Dark"
        }
    }

    public var colorScheme: ColorScheme? {
        switch self {
        case .system: return nil
        case .light: return .light
        case .dark: return .dark
        }
    }
}

public class ThemeManager: ObservableObject {
    public static let shared = ThemeManager()
    private let themeKey = "ob-theme"

    @Published public var mode: ThemeMode {
        didSet {
            UserDefaults.standard.set(mode.rawValue, forKey: themeKey)
        }
    }

    public init() {
        if let saved = UserDefaults.standard.string(forKey: "ob-theme"),
           let parsed = ThemeMode(rawValue: saved) {
            self.mode = parsed
        } else {
            self.mode = .system
        }
    }

    public func toggle(currentSystemScheme: ColorScheme) {
        switch mode {
        case .system:
            mode = (currentSystemScheme == .dark) ? .light : .dark
        case .light:
            mode = .dark
        case .dark:
            mode = .light
        }
    }
}
