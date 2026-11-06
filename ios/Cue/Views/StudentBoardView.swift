import SwiftUI
import CueCore

public struct StudentBoardView: View {
    @ObservedObject var viewModel: CueStudentViewModel
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    public init(viewModel: CueStudentViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        let view = viewModel.orderView
        let readyList = view.ready
        let prepList = view.preparing

        VStack(spacing: CueTheme.space4) {
            // MARK: - Hero Card: Latest Ready Token
            if let latest = readyList.first {
                let now = Int64(Date().timeIntervalSince1970 * 1000)
                let ageStr = TokenRules.formatAge(elapsedMs: now - latest.readyMs)

                VStack(spacing: 4) {
                    Text("NOW SERVING")
                        .font(.system(size: 16, weight: .heavy))
                        .tracking(1.0)
                        .foregroundColor(CueTheme.redInk.opacity(0.92))

                    Text("\(latest.token)")
                        .font(.system(size: 130, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(CueTheme.redInk)
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)

                    Text("Ready \(ageStr)")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundColor(CueTheme.redInk.opacity(0.9))
                }
                .padding(.vertical, 28)
                .padding(.horizontal, 24)
                .frame(maxWidth: .infinity)
                .background(CueTheme.red)
                .clipShape(RoundedRectangle(cornerRadius: 36))
                .shadow(color: CueTheme.red.opacity(0.25), radius: 14, x: 0, y: 6)
            } else {
                // Empty state for ready
                VStack(spacing: 8) {
                    Text("Ready tokens will appear here")
                        .font(.system(size: 20, weight: .heavy))
                        .foregroundColor(CueTheme.mute(for: colorScheme))
                }
                .padding(.vertical, 40)
                .frame(maxWidth: .infinity)
                .background(CueTheme.card(for: colorScheme))
                .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusCard))
            }

            // MARK: - Preparing Strip
            if !prepList.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Preparing")
                        .font(.system(size: 14, weight: .heavy))
                        .tracking(0.6)
                        .textCase(.uppercase)
                        .foregroundColor(CueTheme.mute(for: colorScheme))

                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(prepList) { order in
                                let isMine = viewModel.isTracked(order.token)
                                Text("\(order.token)")
                                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                                    .monospacedDigit()
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 8)
                                    .background(isMine ? CueTheme.ink(for: colorScheme) : CueTheme.card(for: colorScheme))
                                    .foregroundColor(isMine ? CueTheme.bg(for: colorScheme) : CueTheme.cardInk)
                                    .clipShape(Capsule())
                                    .overlay(
                                        Capsule()
                                            .stroke(isMine ? CueTheme.red : CueTheme.line(for: colorScheme), lineWidth: isMine ? 2 : 1)
                                    )
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            // MARK: - Ready Tokens Grid (other ready tokens)
            if readyList.count > 1 {
                VStack(alignment: .leading, spacing: 10) {
                    Text("All ready tokens")
                        .font(.system(size: 18, weight: .heavy))
                        .foregroundColor(CueTheme.ink(for: colorScheme))

                    let columns = [GridItem(.adaptive(minimum: 90), spacing: 12)]
                    LazyVGrid(columns: columns, spacing: 12) {
                        ForEach(readyList.dropFirst()) { order in
                            let isMine = viewModel.isTracked(order.token)
                            let now = Int64(Date().timeIntervalSince1970 * 1000)
                            let ageStr = TokenRules.formatCompactAge(elapsedMs: now - order.readyMs)

                            VStack(spacing: 2) {
                                Text("\(order.token)")
                                    .font(.system(size: 36, weight: .heavy, design: .rounded))
                                    .monospacedDigit()
                                    .foregroundColor(CueTheme.cardInk)

                                Text(ageStr)
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundColor(CueTheme.cardInk.opacity(0.7))
                            }
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity)
                            .background(CueTheme.p2)
                            .clipShape(RoundedRectangle(cornerRadius: 22))
                            .overlay(
                                RoundedRectangle(cornerRadius: 22)
                                    .stroke(isMine ? CueTheme.red : Color.clear, lineWidth: 3)
                            )
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}
