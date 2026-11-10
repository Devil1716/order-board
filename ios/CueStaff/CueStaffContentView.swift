import SwiftUI
import CueCore

public struct CueStaffContentView: View {
    @StateObject private var viewModel = CueStaffViewModel()
    @ObservedObject private var themeManager = ThemeManager.shared
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.horizontalSizeClass) private var sizeClass

    public init() {}

    public var body: some View {
        Group {
            if !viewModel.isUnlocked {
                PinGateView(viewModel: viewModel)
            } else {
                mainContent
            }
        }
        .preferredColorScheme(themeManager.mode.colorScheme)
        .sheet(isPresented: $viewModel.showPinSettings) {
            PinSettingsSheet(viewModel: viewModel)
        }
    }

    private var mainContent: some View {
        ZStack(alignment: .bottom) {
            CueTheme.bg(for: colorScheme)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                CueStaffHeaderView(viewModel: viewModel)

                ScrollView(.vertical, showsIndicators: false) {
                    if sizeClass == .regular {
                        // iPad / Widescreen two-column layout matching CSS @media(min-width:860px)
                        HStack(alignment: .top, spacing: CueTheme.space4) {
                            StaffKeypadPanel(viewModel: viewModel)
                                .frame(width: 360)

                            StaffTilesPanel(viewModel: viewModel)
                                .frame(maxWidth: .infinity)
                        }
                        .padding(.horizontal, CueTheme.gutter)
                        .padding(.top, 8)
                        .padding(.bottom, 60)
                    } else {
                        // iPhone stacked layout
                        VStack(spacing: CueTheme.space3) {
                            StaffKeypadPanel(viewModel: viewModel)
                            StaffTilesPanel(viewModel: viewModel)
                        }
                        .padding(.horizontal, CueTheme.gutter)
                        .padding(.top, 8)
                        .padding(.bottom, 60)
                    }
                }
            }

            // Floating Toast notification
            if let msg = viewModel.toastMessage {
                ToastOverlayView(
                    message: msg,
                    showUndo: viewModel.showUndo,
                    onUndo: { viewModel.triggerUndo() }
                )
            }
        }
    }
}

#Preview("Staff App - Light") {
    CueStaffContentView()
        .preferredColorScheme(.light)
}

#Preview("Staff App - Dark") {
    CueStaffContentView()
        .preferredColorScheme(.dark)
}
