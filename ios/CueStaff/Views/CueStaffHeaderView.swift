import SwiftUI
import CueCore

public struct CueStaffHeaderView: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @ObservedObject var themeManager = ThemeManager.shared
    @ObservedObject var soundService = SoundService.shared
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CueStaffViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        HStack(alignment: .center, spacing: CueTheme.space1) {
            // Brand Logo & Title
            HStack(spacing: 10) {
                Image("logo")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 36, height: 36)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(Color.black.opacity(0.06), lineWidth: 1)
                    )

                Text("Cue Staff")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))
            }

            Spacer()

            // Header Actions
            HStack(spacing: 8) {
                // Theme Toggle
                Button {
                    themeManager.toggle(currentSystemScheme: colorScheme)
                } label: {
                    Text(themeManager.mode == .dark ? "Dark" : "Light")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(CueTheme.card(for: colorScheme))
                        .foregroundColor(CueTheme.cardInk)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                        )
                }

                // Sound Toggle
                Button {
                    soundService.toggleSound()
                } label: {
                    Text(soundService.isSoundEnabled ? "Sound on" : "Sound off")
                        .font(.system(size: 13, weight: .bold))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 40)
                        .background(soundService.isSoundEnabled ? CueTheme.ink(for: colorScheme) : CueTheme.card(for: colorScheme))
                        .foregroundColor(soundService.isSoundEnabled ? CueTheme.bg(for: colorScheme) : CueTheme.cardInk)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                        )
                }

                // Settings / Lock
                Button {
                    viewModel.showPinSettings = true
                } label: {
                    Image(systemName: KeychainService.isPinEnabled ? "lock.fill" : "gearshape.fill")
                        .font(.system(size: 14, weight: .bold))
                        .frame(width: 40, height: 40)
                        .background(CueTheme.card(for: colorScheme))
                        .foregroundColor(CueTheme.cardInk)
                        .clipShape(Circle())
                        .overlay(
                            Circle()
                                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                        )
                }
            }
        }
        .padding(.horizontal, CueTheme.gutter)
        .padding(.vertical, 10)
    }
}
