import SwiftUI
import CueCore

public struct CueStaffHeaderView: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CueStaffViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        HStack(alignment: .center, spacing: CueTheme.space1) {
            // Brand Logo & Title
            HStack(spacing: 10) {
                CueLogoView(size: 36, cornerRadius: 10)

                Text("Cue Staff")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))
            }

            Spacer()

            // Logo + gear only; theme and sound live in settings (same as Android).
            CueGearButton(systemImage: KeychainService.isPinEnabled ? "lock.fill" : "gearshape.fill") {
                viewModel.showPinSettings = true
            }
        }
        .padding(.horizontal, CueTheme.gutter)
        .padding(.vertical, 10)
    }
}
