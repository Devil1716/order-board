import SwiftUI
import CueCore

public struct StaffTilesPanel: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @Environment(\.colorScheme) private var colorScheme
    private let limit = 8

    public init(viewModel: CueStaffViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: CueTheme.space3) {
            // MARK: - Preparing Section ("Up next")
            VStack(alignment: .leading, spacing: 6) {
                let prepList = viewModel.filteredPreparing
                let totalPrep = viewModel.orderView.preparing.count

                Text(totalPrep > 0 ? "Up next · \(totalPrep)" : "Up next")
                    .font(.system(size: 20, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))

                Text(prepHintText)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(CueTheme.mute(for: colorScheme))
                    .padding(.bottom, 6)

                if prepList.isEmpty {
                    Text(viewModel.typed.isEmpty ? "No orders preparing." : "No match for \(viewModel.typed).")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundColor(CueTheme.mute(for: colorScheme))
                        .padding(.vertical, 16)
                } else {
                    let displayedPrep = (viewModel.showAllPrep || !viewModel.typed.isEmpty) ? prepList : Array(prepList.prefix(limit))
                    let columns = [GridItem(.adaptive(minimum: 120), spacing: 10)]

                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(displayedPrep) { order in
                            let isOldest = (order == viewModel.oldestPreparing)
                            preparingTile(order: order, isOldest: isOldest)
                        }
                    }

                    if viewModel.typed.isEmpty && prepList.count > limit {
                        Button {
                            viewModel.showAllPrep.toggle()
                        } label: {
                            Text(viewModel.showAllPrep ? "Show fewer" : "Show all \(prepList.count)")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(CueTheme.mute(for: colorScheme))
                                .underline()
                                .padding(.top, 4)
                        }
                    }
                }
            }

            // MARK: - Ready Section
            let readyList = viewModel.filteredReady
            let totalReady = viewModel.orderView.ready.count

            if totalReady > 0 {
                Divider()
                    .padding(.vertical, 6)

                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(totalReady > 0 ? "Ready — tap when handed over · \(totalReady)" : "Ready — tap when handed over")
                            .font(.system(size: 18, weight: .heavy))
                            .foregroundColor(CueTheme.ink(for: colorScheme))

                        Spacer()

                        Button {
                            viewModel.showClearAllConfirm = true
                        } label: {
                            Text("Clear all")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(CueTheme.mute(for: colorScheme))
                                .underline()
                        }
                    }

                    Text("Removes it from the student view.")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(CueTheme.mute(for: colorScheme))
                        .padding(.bottom, 6)

                    let displayedReady = (viewModel.showAllReady || !viewModel.typed.isEmpty) ? readyList : Array(readyList.prefix(limit))
                    let columns = [GridItem(.adaptive(minimum: 120), spacing: 10)]

                    LazyVGrid(columns: columns, spacing: 10) {
                        ForEach(displayedReady) { order in
                            readyTile(order: order)
                        }
                    }

                    if viewModel.typed.isEmpty && readyList.count > limit {
                        Button {
                            viewModel.showAllReady.toggle()
                        } label: {
                            Text(viewModel.showAllReady ? "Show fewer" : "Show all \(readyList.count)")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(CueTheme.mute(for: colorScheme))
                                .underline()
                                .padding(.top, 4)
                        }
                    }
                }
            }

            // Sync Footer Label
            Text(viewModel.syncLabel)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(CueTheme.mute(for: colorScheme).opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, CueTheme.space3)
        }
        .padding(CueTheme.space3)
        .background(CueTheme.card(for: colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusPanel))
        .overlay(
            RoundedRectangle(cornerRadius: CueTheme.radiusPanel)
                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
        )
        .confirmationDialog(
            "Clear all ready orders?",
            isPresented: $viewModel.showClearAllConfirm,
            titleVisibility: .visible
        ) {
            Button("Clear all", role: .destructive) {
                viewModel.clearAllReady()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("This will mark all \(viewModel.orderView.ready.count) ready orders as collected.")
        }
    }

    private var prepHintText: String {
        if !viewModel.typed.isEmpty {
            return "Filtered to “\(viewModel.typed)”."
        }
        if viewModel.orderView.preparing.isEmpty {
            return "Quiet for now."
        }
        return "Red tile is oldest — tap it when ready."
    }

    // Individual preparing tile
    private func preparingTile(order: Order, isOldest: Bool) -> some View {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let ageStr = TokenRules.formatCompactAge(elapsedMs: now - order.createdMs)

        return VStack(spacing: 2) {
            Button {
                viewModel.callReady(order.token)
            } label: {
                VStack(spacing: 0) {
                    Text("\(order.token)")
                        .font(.system(size: 42, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(isOldest ? CueTheme.redInk : CueTheme.ink(for: colorScheme))
                        .frame(maxWidth: .infinity, minHeight: 64)

                    Text(ageStr)
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(isOldest ? CueTheme.redInk.opacity(0.9) : CueTheme.mute(for: colorScheme))

                    if isOldest {
                        Text("UP NEXT")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundColor(CueTheme.redInk.opacity(0.95))
                            .padding(.top, 2)
                    }
                }
            }

            Button {
                viewModel.cancelPreparingOrder(order.token)
            } label: {
                Text("Cancel order")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(isOldest ? CueTheme.redInk.opacity(0.8) : CueTheme.mute(for: colorScheme))
                    .underline()
                    .padding(.vertical, 4)
            }
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 6)
        .background(isOldest ? CueTheme.red : CueTheme.tileBg(for: colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusTile))
        .shadow(color: isOldest ? CueTheme.red.opacity(0.3) : Color.clear, radius: 8, x: 0, y: 4)
    }

    // Individual ready tile
    private func readyTile(order: Order) -> some View {
        Button {
            viewModel.handOver(order.token)
        } label: {
            VStack(spacing: 2) {
                Text("\(order.token)")
                    .font(.system(size: 42, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(CueTheme.ink(for: colorScheme))
                    .frame(maxWidth: .infinity, minHeight: 80)
            }
            .padding(.vertical, 8)
            .background(CueTheme.readyTileBg(for: colorScheme))
            .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusTile))
        }
        .accessibilityLabel("Token \(order.token) handed over")
    }
}
