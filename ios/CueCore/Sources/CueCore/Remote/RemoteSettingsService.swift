import Foundation
import Combine
import FirebaseCore
import FirebaseRemoteConfig

/// Loads Firebase Remote Config once per launch and publishes `RemoteSettings`.
/// No-ops when Firebase isn't configured (local mode), so the app behaves exactly as built.
public final class RemoteSettingsService: ObservableObject {
    public static let shared = RemoteSettingsService()

    @Published public private(set) var settings = RemoteSettings()

    private var started = false

    public static var installedVersion: String {
        (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "0"
    }

    public func updateRequired(for app: CueAppKind) -> Bool {
        settings.updateRequired(for: app, installedVersion: Self.installedVersion)
    }

    /// Call after `FirebaseApp.configure()`. Safe to call repeatedly.
    public func start() {
        guard !started, FirebaseApp.app() != nil else { return }
        started = true

        let rc = RemoteConfig.remoteConfig()
        let config = RemoteConfigSettings()
        #if DEBUG
        config.minimumFetchInterval = 0
        #else
        config.minimumFetchInterval = 1800
        #endif
        rc.configSettings = config
        rc.setDefaults(RemoteSettings.defaultValues.mapValues { $0 as NSString })

        // Use whatever was cached from the last launch right away, then refresh.
        apply(rc)
        rc.fetchAndActivate { [weak self] _, _ in
            DispatchQueue.main.async { self?.apply(rc) }
        }
    }

    private func apply(_ rc: RemoteConfig) {
        var raw: [String: String] = [:]
        for key in RemoteSettings.defaultValues.keys {
            let value: String? = rc.configValue(forKey: key).stringValue
            raw[key] = value ?? ""
        }
        let next = RemoteSettings(values: raw)
        next.applyThresholds()
        if next != settings { settings = next }
    }
}
