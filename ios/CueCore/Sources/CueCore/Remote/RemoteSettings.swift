import Foundation

/// Which native app is asking (used to pick the right minimum-version key).
/// Named `CueAppKind` so it never clashes with the `CueApp` entry point in the Student target.
public enum CueAppKind: String {
    case student
    case staff
}

/// Dotted-number version comparison ("1.10.0" > "1.9.2"). Missing parts count as 0; non-digits are ignored.
public enum VersionCompare {
    public static func parts(_ v: String) -> [Int] {
        v.split(separator: ".").map { Int($0.filter(\.isNumber)) ?? 0 }
    }

    /// -1 if a < b, 0 if equal, 1 if a > b.
    public static func compare(_ a: String, _ b: String) -> Int {
        let x = parts(a), y = parts(b)
        for i in 0..<max(x.count, y.count) {
            let l = i < x.count ? x[i] : 0
            let r = i < y.count ? y[i] : 0
            if l != r { return l < r ? -1 : 1 }
        }
        return 0
    }

    public static func isLess(_ a: String, than b: String) -> Bool { compare(a, b) < 0 }
}

/// Server-driven values (Firebase Remote Config). Pure and Firebase-free so it is unit-testable.
/// Every key is optional: an empty/missing value means "use the built-in behaviour".
public struct RemoteSettings: Equatable {
    public enum Key {
        public static let minVersionStudent = "min_version_student"
        public static let minVersionStaff = "min_version_staff"
        public static let updateURL = "update_url"
        public static let updateMessage = "update_message"
        public static let announcement = "announcement"
        public static let readyExpiryMinutes = "ready_expiry_minutes"
        public static let staleWindowHours = "stale_window_hours"
    }

    public var minVersionStudent: String = ""
    public var minVersionStaff: String = ""
    public var updateURL: String = ""
    public var updateMessage: String = ""
    public var announcement: String = ""
    public var readyExpiryMinutes: Int? = nil
    public var staleWindowHours: Int? = nil

    public init() {}

    /// Builds settings from raw string values (what Remote Config hands back).
    public init(values: [String: String]) {
        func clean(_ k: String) -> String { (values[k] ?? "").trimmingCharacters(in: .whitespacesAndNewlines) }
        minVersionStudent = clean(Key.minVersionStudent)
        minVersionStaff = clean(Key.minVersionStaff)
        updateURL = clean(Key.updateURL)
        updateMessage = clean(Key.updateMessage)
        announcement = clean(Key.announcement)
        readyExpiryMinutes = Int(clean(Key.readyExpiryMinutes))
        staleWindowHours = Int(clean(Key.staleWindowHours))
    }

    /// Defaults registered with Remote Config; equal to the built-in behaviour.
    public static let defaultValues: [String: String] = [
        Key.minVersionStudent: "",
        Key.minVersionStaff: "",
        Key.updateURL: "",
        Key.updateMessage: "A new version of Cue is required to keep working with the counter.",
        Key.announcement: "",
        Key.readyExpiryMinutes: String(TokenRules.baseExpiryMinutes),
        Key.staleWindowHours: String(TokenRules.baseStaleWindowHours)
    ]

    public func minVersion(for app: CueAppKind) -> String {
        app == .student ? minVersionStudent : minVersionStaff
    }

    /// True when the installed version is older than the minimum the server asks for.
    public func updateRequired(for app: CueAppKind, installedVersion: String) -> Bool {
        let min = minVersion(for: app)
        return !min.isEmpty && VersionCompare.isLess(installedVersion, than: min)
    }

    /// The https URL for the "Update" button, or nil if unset/unsafe.
    public var safeUpdateURL: URL? {
        guard let url = URL(string: updateURL), url.scheme == "https" else { return nil }
        return url
    }

    /// Pushes the thresholds into `TokenRules` (clamped there so they can only lengthen).
    public func applyThresholds() {
        TokenRules.applyRemote(expiryMinutes: readyExpiryMinutes, staleWindowHours: staleWindowHours)
    }
}
