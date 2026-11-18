import SwiftUI

/// Settings rows shared by both apps, matching the Android settings page
/// (Appearance, Alerts, About). Use inside a `Form`.
public struct CueAppearanceSection: View {
    @ObservedObject private var theme = ThemeManager.shared

    public init() {}

    public var body: some View {
        Section(header: Text("Appearance")) {
            Picker("Appearance", selection: $theme.mode) {
                ForEach(ThemeMode.allCases, id: \.self) { mode in
                    Text(mode.title).tag(mode)
                }
            }
            .pickerStyle(.segmented)
        }
    }
}

public struct CueAlertsSection: View {
    @ObservedObject private var sound = SoundService.shared
    private let subtitle: String

    public init(subtitle: String) {
        self.subtitle = subtitle
    }

    public var body: some View {
        Section(header: Text("Alerts")) {
            Toggle(isOn: Binding(
                get: { sound.isSoundEnabled },
                set: { if $0 != sound.isSoundEnabled { sound.toggleSound() } }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sound")
                    Text(subtitle)
                        .font(.footnote)
                        .foregroundColor(.secondary)
                }
            }
            .tint(CueTheme.red)
        }
    }
}

public struct CueAboutSection: View {
    private let appName: String

    public init(appName: String) {
        self.appName = appName
    }

    public var body: some View {
        Section(header: Text("About")) {
            LabeledContent("App", value: appName)
            LabeledContent("Version", value: RemoteSettingsService.installedVersion)
        }
    }
}

/// The round gear button used in both app headers.
public struct CueGearButton: View {
    private let systemImage: String
    private let action: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    public init(systemImage: String = "gearshape.fill", action: @escaping () -> Void) {
        self.systemImage = systemImage
        self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .bold))
                .frame(width: 44, height: 44)
                .background(CueTheme.card(for: colorScheme))
                .foregroundColor(CueTheme.ink(for: colorScheme))
                .clipShape(Circle())
                .overlay(Circle().stroke(CueTheme.line(for: colorScheme), lineWidth: 1))
        }
        .accessibilityLabel("Settings")
    }
}
