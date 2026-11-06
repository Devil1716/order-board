import SwiftUI
import CueCore

public struct CueStudentContentView: View {
    @StateObject private var viewModel = CueStudentViewModel()
    @ObservedObject private var themeManager = ThemeManager.shared
    @Environment(\.colorScheme) private var colorScheme

    public init() {}

    public var body: some View {
        ZStack {
            CueTheme.bg(for: colorScheme)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                CueStudentHeaderView(viewModel: viewModel)

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: CueTheme.space4) {
                        if viewModel.viewMode == .myOrders {
                            if viewModel.trackedTokens.isEmpty {
                                StudentEmptyEntryView(viewModel: viewModel)
                            } else {
                                StudentTrackingListView(viewModel: viewModel)
                            }

                            StudentReadyStripView(viewModel: viewModel)
                        } else {
                            StudentBoardView(viewModel: viewModel)
                        }

                        // Sync Footer Label
                        Text(viewModel.syncLabel)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundColor(CueTheme.mute(for: colorScheme).opacity(0.75))
                            .multilineTextAlignment(.center)
                            .padding(.top, 16)
                            .padding(.bottom, 32)
                    }
                    .padding(.horizontal, CueTheme.gutter)
                    .padding(.top, 8)
                }
            }

            // Full-screen Ready Alert
            if let alertToken = viewModel.alertToken {
                FullScreenAlertView(
                    token: alertToken,
                    onDismiss: {
                        viewModel.dismissAlert()
                    }
                )
                .transition(.opacity)
                .zIndex(100)
            }
        }
        .preferredColorScheme(themeManager.mode.colorScheme)
        .animation(.easeInOut(duration: 0.25), value: viewModel.alertToken)
    }
}

#Preview("Student App - Light") {
    CueStudentContentView()
        .preferredColorScheme(.light)
}

#Preview("Student App - Dark") {
    CueStudentContentView()
        .preferredColorScheme(.dark)
}
