import SwiftUI
import CueCore

public struct StudentEmptyEntryView: View {
    @ObservedObject var viewModel: CueStudentViewModel
    @Environment(\.colorScheme) private var colorScheme
    @FocusState private var isInputFocused: Bool

    public init(viewModel: CueStudentViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 20)

            Text("Enter your token")
                .font(.system(size: 34, weight: .heavy))
                .foregroundColor(CueTheme.ink(for: colorScheme))
                .multilineTextAlignment(.center)
                .padding(.bottom, 8)

            Text("We’ll tell you when your food is ready.")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(CueTheme.mute(for: colorScheme))
                .multilineTextAlignment(.center)
                .padding(.bottom, 28)

            // Input field
            TextField("000", text: $viewModel.tokenInput)
                .font(.system(size: 38, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .focused($isInputFocused)
                .padding(.vertical, 14)
                .padding(.horizontal, 20)
                .background(CueTheme.bg(for: colorScheme))
                .foregroundColor(CueTheme.ink(for: colorScheme))
                .clipShape(Capsule())
                .overlay(
                    Capsule()
                        .stroke(CueTheme.line(for: colorScheme), lineWidth: 2)
                )
                .frame(maxWidth: 260)
                .onChange(of: viewModel.tokenInput) { newValue in
                    let filtered = newValue.filter { $0.isNumber }
                    if filtered.count > 3 {
                        viewModel.tokenInput = String(filtered.prefix(3))
                    } else {
                        viewModel.tokenInput = filtered
                    }
                }
                .onSubmit {
                    viewModel.trackInputToken()
                }

            // Track button
            Button {
                viewModel.trackInputToken()
                isInputFocused = false
            } label: {
                Text("Track my order")
                    .font(.system(size: 19, weight: .heavy))
                    .frame(maxWidth: 280, minHeight: 56)
                    .background(viewModel.tokenInput.isEmpty ? CueTheme.line(for: colorScheme) : CueTheme.red)
                    .foregroundColor(viewModel.tokenInput.isEmpty ? CueTheme.mute(for: colorScheme) : CueTheme.redInk)
                    .clipShape(Capsule())
            }
            .disabled(viewModel.tokenInput.isEmpty)
            .padding(.top, 18)

            Spacer(minLength: 30)
        }
        .padding(.horizontal, CueTheme.gutter)
    }
}
