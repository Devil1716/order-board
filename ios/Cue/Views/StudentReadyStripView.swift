import SwiftUI
import CueCore

public struct StudentReadyStripView: View {
    @ObservedObject var viewModel: CueStudentViewModel
    @Environment(\.colorScheme) private var colorScheme
    private let maxChips = 12

    public init(viewModel: CueStudentViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        let readyList = viewModel.orderView.ready
        let isTracking = !viewModel.trackedTokens.isEmpty

        VStack(alignment: .leading, spacing: CueTheme.space2) {
            Text(isTracking ? "Also ready" : "What’s ready")
                .font(.system(size: 15, weight: .heavy))
                .tracking(0.6)
                .textCase(.uppercase)
                .foregroundColor(CueTheme.mute(for: colorScheme))

            if readyList.isEmpty {
                Text("Nothing ready yet.")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(CueTheme.mute(for: colorScheme))
                    .padding(.vertical, 8)
            } else {
                let displayed = Array(readyList.prefix(maxChips))

                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(displayed.enumerated()), id: \.element.token) { index, order in
                            let isMine = viewModel.isTracked(order.token)
                            let isLatest = (index == 0 && !isMine)

                            Text("\(order.token)")
                                .font(.system(size: 18, weight: .heavy, design: .rounded))
                                .monospacedDigit()
                                .padding(.horizontal, 16)
                                .frame(minWidth: 48, minHeight: 44)
                                .background(isMine ? CueTheme.red : CueTheme.card(for: colorScheme))
                                .foregroundColor(isMine ? CueTheme.redInk : CueTheme.cardInk)
                                .clipShape(Capsule())
                                .overlay(
                                    Capsule()
                                        .stroke(isLatest ? CueTheme.red : CueTheme.line(for: colorScheme), lineWidth: isLatest ? 2 : 1)
                                )
                        }

                        if readyList.count > maxChips {
                            Text("+\(readyList.count - maxChips) more")
                                .font(.system(size: 13, weight: .bold))
                                .foregroundColor(CueTheme.mute(for: colorScheme))
                                .padding(.leading, 4)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
