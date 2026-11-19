import SwiftUI
import CueCore

/// Logo + gear only; theme and sound live on the settings page (same as Android).
public struct CueStudentHeaderView: View {
    @ObservedObject var viewModel: CueStudentViewModel
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CueStudentViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        HStack(alignment: .center, spacing: 8) {
            HStack(spacing: 10) {
                CueLogoView(size: 36, cornerRadius: 10)

                Text("Cue")
                    .font(.system(size: 22, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))
            }

            Spacer()

            CueGearButton { viewModel.showSettings = true }
        }
        .padding(.horizontal, CueTheme.gutter)
        .padding(.vertical, 8)
    }
}
