import SwiftUI

/// Wraps an app's root view: shows an announcement banner when the server sets one, and a blocking
/// "Update required" screen when the installed version is below the server's minimum.
public struct CueUpdateGate: ViewModifier {
    let app: CueAppKind
    @ObservedObject private var service = RemoteSettingsService.shared
    @Environment(\.openURL) private var openURL

    public init(app: CueAppKind) { self.app = app }

    public func body(content: Content) -> some View {
        ZStack {
            content
                .safeAreaInset(edge: .top, spacing: 0) {
                    if !service.settings.announcement.isEmpty {
                        Text(service.settings.announcement)
                            .font(.system(size: 14, weight: .semibold))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 10)
                            .padding(.horizontal, 16)
                            .foregroundColor(CueTheme.redInk)
                            .background(CueTheme.red)
                            .accessibilityAddTraits(.isStaticText)
                    }
                }

            if service.updateRequired(for: app) {
                VStack(spacing: 20) {
                    CueLogoView(size: 64, cornerRadius: 16)
                    Text("Update required")
                        .font(.system(size: 28, weight: .heavy))
                    Text(service.settings.updateMessage)
                        .font(.system(size: 17))
                        .multilineTextAlignment(.center)
                        .foregroundColor(.secondary)
                    if let url = service.settings.safeUpdateURL {
                        Button("Update") { openURL(url) }
                            .buttonStyle(.borderedProminent)
                            .tint(CueTheme.red)
                            .controlSize(.large)
                    }
                }
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color(.systemBackground).ignoresSafeArea())
                .accessibilityElement(children: .contain)
            }
        }
    }
}

public extension View {
    /// Applies the Remote Config announcement banner + minimum-version gate.
    func cueUpdateGate(_ app: CueAppKind) -> some View {
        modifier(CueUpdateGate(app: app))
    }
}
