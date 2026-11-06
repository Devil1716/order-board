import SwiftUI
import CueCore

public struct CueStudentHeaderView: View {
    @ObservedObject var viewModel: CueStudentViewModel
    @ObservedObject var themeManager = ThemeManager.shared
    @ObservedObject var soundService = SoundService.shared
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CueStudentViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 8) {
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

                Text("Cue")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))
            }

            Spacer()

            // View Mode Switcher Picker
            Picker("Mode", selection: $viewModel.viewMode) {
                ForEach(StudentViewMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 190)

            // Theme Toggle
            Button {
                themeManager.toggle(currentSystemScheme: colorScheme)
            } label: {
                Text(themeManager.mode == .dark ? "Dark" : "Light")
                    .font(.system(size: 13, weight: .bold))
                    .padding(.horizontal, 14)
                    .frame(minHeight: 38)
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
                Image(systemName: soundService.isSoundEnabled ? "speaker.wave.2.fill" : "speaker.slash.fill")
                    .font(.system(size: 13, weight: .bold))
                    .frame(width: 38, height: 38)
                    .background(soundService.isSoundEnabled ? CueTheme.ink(for: colorScheme) : CueTheme.card(for: colorScheme))
                    .foregroundColor(soundService.isSoundEnabled ? CueTheme.bg(for: colorScheme) : CueTheme.cardInk)
                    .clipShape(Circle())
                    .overlay(
                        Circle()
                            .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                    )
            }
        }
        .padding(.horizontal, CueTheme.gutter)
        .padding(.vertical, 8)
    }
}
