import SwiftUI
import CueCore

public struct StudentTrackingListView: View {
    @ObservedObject var viewModel: CueStudentViewModel
    @Environment(\.colorScheme) private var colorScheme
    @State private var addTokenInput: String = ""

    public init(viewModel: CueStudentViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(spacing: CueTheme.space3) {
            // Section Title
            Text(viewModel.trackedTokens.count == 1 ? "Your order" : "Your orders")
                .font(.system(size: 22, weight: .heavy))
                .foregroundColor(CueTheme.ink(for: colorScheme))
                .frame(maxWidth: .infinity, alignment: .leading)

            // Cards for each tracked token
            VStack(spacing: 14) {
                ForEach(viewModel.trackedTokens, id: \.self) { token in
                    trackedOrderCard(for: token)
                }
            }

            // Compact "Add another" Card
            VStack(spacing: 6) {
                Text("Add another")
                    .font(.system(size: 18, weight: .heavy))
                    .foregroundColor(CueTheme.cardInk)

                Text("Same counter, another token.")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(CueTheme.mute(for: colorScheme))

                HStack(spacing: 10) {
                    TextField("000", text: $addTokenInput)
                        .font(.system(size: 22, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .multilineTextAlignment(.center)
                        .keyboardType(.numberPad)
                        .padding(.vertical, 10)
                        .padding(.horizontal, 16)
                        .background(CueTheme.bg(for: colorScheme))
                        .foregroundColor(CueTheme.ink(for: colorScheme))
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1.5)
                        )
                        .frame(width: 120)
                        .onChange(of: addTokenInput) { newValue in
                            let filtered = newValue.filter { $0.isNumber }
                            if filtered.count > 3 {
                                addTokenInput = String(filtered.prefix(3))
                            } else {
                                addTokenInput = filtered
                            }
                        }

                    Button {
                        if let n = Int(addTokenInput), TokenRules.isValidToken(n) {
                            addTokenInput = ""
                            Task {
                                _ = await viewModel.store.addTrackedToken(n)
                                viewModel.trackedTokens = await viewModel.store.getTrackedTokens()
                                viewModel.checkForReadyAlerts()
                            }
                        }
                    } label: {
                        Text("Add order")
                            .font(.system(size: 16, weight: .bold))
                            .padding(.horizontal, 18)
                            .frame(minHeight: 46)
                            .background(addTokenInput.isEmpty ? CueTheme.line(for: colorScheme) : CueTheme.red)
                            .foregroundColor(addTokenInput.isEmpty ? CueTheme.mute(for: colorScheme) : CueTheme.redInk)
                            .clipShape(Capsule())
                    }
                    .disabled(addTokenInput.isEmpty)
                }
                .padding(.top, 4)
            }
            .padding(CueTheme.space3)
            .frame(maxWidth: .infinity)
            .background(CueTheme.card(for: colorScheme))
            .clipShape(RoundedRectangle(cornerRadius: 24))
            .overlay(
                RoundedRectangle(cornerRadius: 24)
                    .stroke(CueTheme.line(for: colorScheme), style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]))
            )
        }
    }

    private func trackedOrderCard(for token: Int) -> some View {
        let state = viewModel.tokenState(for: token)

        return VStack(spacing: 4) {
            Text("TOKEN")
                .font(.system(size: 13, weight: .heavy))
                .tracking(0.8)
                .foregroundColor(CueTheme.mute(for: colorScheme))
                .padding(.top, 4)

            Text("\(token)")
                .font(.system(size: 64, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .foregroundColor(CueTheme.cardInk)

            Text(state.title)
                .font(.system(size: 20, weight: .heavy))
                .foregroundColor(state.isReady ? CueTheme.red : CueTheme.cardInk)

            if !state.ageText.isEmpty {
                Text(state.ageText)
                    .font(.system(size: 14, weight: .bold))
                    .monospacedDigit()
                    .foregroundColor(CueTheme.mute(for: colorScheme))
            }

            Text(state.subtitle)
                .font(.system(size: 15, weight: .semibold))
                .foregroundColor(CueTheme.mute(for: colorScheme))
                .padding(.bottom, 6)

            // Card Actions Row
            HStack(spacing: 10) {
                if state.showCollect {
                    Button {
                        viewModel.markCollected(token)
                    } label: {
                        Text("I’ve collected")
                            .font(.system(size: 16, weight: .heavy))
                            .frame(maxWidth: .infinity, minHeight: 48)
                            .background(CueTheme.red)
                            .foregroundColor(CueTheme.redInk)
                            .clipShape(Capsule())
                    }
                }

                Button {
                    viewModel.removeTrackedToken(token)
                } label: {
                    Text("Remove")
                        .font(.system(size: 15, weight: .bold))
                        .frame(maxWidth: state.showCollect ? 120 : .infinity, minHeight: 48)
                        .background(CueTheme.bg(for: colorScheme))
                        .foregroundColor(CueTheme.cardInk)
                        .clipShape(Capsule())
                        .overlay(
                            Capsule()
                                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                        )
                }
            }
            .padding(.top, 4)
        }
        .padding(CueTheme.space3)
        .frame(maxWidth: .infinity)
        .background(CueTheme.card(for: colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusCard))
        .overlay(
            RoundedRectangle(cornerRadius: CueTheme.radiusCard)
                .stroke(state.isReady ? CueTheme.red : CueTheme.line(for: colorScheme), lineWidth: state.isReady ? 2.5 : 1)
        )
        .shadow(color: state.isReady ? CueTheme.red.opacity(0.18) : Color.black.opacity(0.04), radius: 8, x: 0, y: 2)
    }
}
