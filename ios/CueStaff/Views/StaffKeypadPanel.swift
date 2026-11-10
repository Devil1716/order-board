import SwiftUI
import CueCore

public struct StaffKeypadPanel: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CueStaffViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(spacing: CueTheme.space2) {
            // Token Entry Display
            ZStack {
                RoundedRectangle(cornerRadius: 24)
                    .fill(CueTheme.bg(for: colorScheme))

                if viewModel.typed.isEmpty {
                    Text("Type a token")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundColor(CueTheme.mute(for: colorScheme))
                } else {
                    Text(viewModel.typed)
                        .font(.system(size: 38, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .foregroundColor(CueTheme.ink(for: colorScheme))
                }
            }
            .frame(height: 64)

            // Numpad Grid (1-9, Clear, 0, Delete)
            let keys = [
                ["1", "2", "3"],
                ["4", "5", "6"],
                ["7", "8", "9"],
                ["Clear", "0", "Delete"]
            ]

            VStack(spacing: 8) {
                ForEach(keys, id: \.self) { row in
                    HStack(spacing: 8) {
                        ForEach(row, id: \.self) { key in
                            keyButton(key)
                        }
                    }
                }
            }

            // Adaptive Action Buttons
            HStack(spacing: 10) {
                // Main Red Adaptive Button
                Button {
                    viewModel.handleMainAction()
                } label: {
                    Text(viewModel.currentMode.mainButtonTitle(for: viewModel.typedToken))
                        .font(.system(size: 18, weight: .heavy))
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(viewModel.typed.isEmpty ? CueTheme.line(for: colorScheme) : CueTheme.red)
                        .foregroundColor(viewModel.typed.isEmpty ? CueTheme.mute(for: colorScheme) : CueTheme.redInk)
                        .clipShape(Capsule())
                }
                .disabled(viewModel.typed.isEmpty)

                // Cancel Order Button (visible when token in prep)
                if viewModel.currentMode == .preparing, let token = viewModel.typedToken {
                    Button {
                        viewModel.cancelPreparingOrder(token)
                        viewModel.typed = ""
                    } label: {
                        Text("Cancel order")
                            .font(.system(size: 16, weight: .bold))
                            .frame(maxWidth: .infinity, minHeight: 52)
                            .background(CueTheme.bg(for: colorScheme))
                            .foregroundColor(CueTheme.ink(for: colorScheme))
                            .clipShape(Capsule())
                            .overlay(
                                Capsule()
                                    .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                            )
                    }
                }
            }

            // Quick Mark Oldest Ready (when input is empty)
            if viewModel.typed.isEmpty, let oldest = viewModel.oldestPreparing {
                let now = Int64(Date().timeIntervalSince1970 * 1000)
                let ageStr = TokenRules.formatCompactAge(elapsedMs: now - oldest.createdMs)

                Button {
                    viewModel.callReady(oldest.token)
                } label: {
                    Text("Mark \(oldest.token) ready · \(ageStr)")
                        .font(.system(size: 18, weight: .heavy))
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(CueTheme.red)
                        .foregroundColor(CueTheme.redInk)
                        .clipShape(Capsule())
                }
            }

            // Dynamic Hint
            Text(viewModel.currentMode.hint(for: viewModel.typedToken))
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(CueTheme.mute(for: colorScheme))
                .multilineTextAlignment(.center)
                .padding(.top, 2)

            // Generator: Give Next Token
            VStack(spacing: 6) {
                Text("Next number")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(CueTheme.mute(for: colorScheme))

                let suggestion = viewModel.nextTokenSuggestion
                Text(suggestion > 0 ? "\(suggestion)" : "Full")
                    .font(.system(size: 52, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(CueTheme.ink(for: colorScheme))
                    .lineLimit(1)

                Button {
                    viewModel.giveNextToken()
                } label: {
                    Text("Give this token")
                        .font(.system(size: 17, weight: .heavy))
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(suggestion > 0 ? CueTheme.red : CueTheme.line(for: colorScheme))
                        .foregroundColor(suggestion > 0 ? CueTheme.redInk : CueTheme.mute(for: colorScheme))
                        .clipShape(Capsule())
                }
                .disabled(suggestion == 0)

                Button {
                    viewModel.restartNumberingAt1()
                } label: {
                    Text("Restart at 1")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(CueTheme.mute(for: colorScheme))
                        .underline()
                        .padding(.top, 4)
                }
            }
            .padding(CueTheme.space3)
            .background(CueTheme.tileBg(for: colorScheme))
            .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusCard))
            .padding(.top, 8)
        }
        .padding(CueTheme.space3)
        .background(CueTheme.card(for: colorScheme))
        .clipShape(RoundedRectangle(cornerRadius: CueTheme.radiusPanel))
        .overlay(
            RoundedRectangle(cornerRadius: CueTheme.radiusPanel)
                .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
        )
    }

    private func keyButton(_ key: String) -> some View {
        Button {
            viewModel.pressKey(key)
        } label: {
            Text(key)
                .font(key.count > 1 ? .system(size: 15, weight: .heavy) : .system(size: 22, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity, minHeight: 52)
                .background(CueTheme.bg(for: colorScheme))
                .foregroundColor(CueTheme.ink(for: colorScheme))
                .clipShape(RoundedRectangle(cornerRadius: 16))
        }
    }
}
