import SwiftUI
import CueCore

public struct PinGateView: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @State private var pin: String = ""
    @State private var errorMessage: String?
    @State private var confirmPin: String = ""
    @State private var step: Int = 1
    @Environment(\.colorScheme) private var colorScheme

    public init(viewModel: CueStaffViewModel) {
        self.viewModel = viewModel
    }

    private var isSettingNewPin: Bool {
        !KeychainService.hasPin()
    }

    public var body: some View {
        ZStack {
            CueTheme.bg(for: colorScheme)
                .ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()

                CueLogoView(size: 64, cornerRadius: 16)

                Text(isSettingNewPin ? (step == 1 ? "Set Staff PIN" : "Confirm Staff PIN") : "Enter Staff PIN")
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))

                Text(isSettingNewPin ? "Protect counter controls from unauthorized changes." : "Staff access is restricted.")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(CueTheme.mute(for: colorScheme))

                // PIN Dots
                HStack(spacing: 16) {
                    ForEach(0..<4) { index in
                        Circle()
                            .fill(index < currentInput.count ? CueTheme.red : CueTheme.line(for: colorScheme))
                            .frame(width: 18, height: 18)
                    }
                }
                .padding(.vertical, 12)

                if let err = errorMessage {
                    Text(err)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(CueTheme.red)
                }

                // PIN Numpad
                VStack(spacing: 12) {
                    ForEach([["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"]], id: \.self) { row in
                        HStack(spacing: 12) {
                            ForEach(row, id: \.self) { digit in
                                pinKey(digit)
                            }
                        }
                    }
                    HStack(spacing: 12) {
                        if isSettingNewPin {
                            Button("Skip") {
                                KeychainService.hasCompletedOnboarding = true
                                KeychainService.isPinEnabled = false
                                viewModel.isUnlocked = true
                            }
                            .frame(maxWidth: .infinity, minHeight: 60)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(CueTheme.mute(for: colorScheme))
                        } else {
                            Color.clear.frame(maxWidth: .infinity, minHeight: 60)
                        }

                        pinKey("0")

                        Button {
                            HapticsService.light()
                            if !currentInput.isEmpty {
                                if step == 1 { pin.removeLast() }
                                else { confirmPin.removeLast() }
                            }
                        } label: {
                            Image(systemName: "delete.left.fill")
                                .font(.system(size: 20, weight: .bold))
                                .frame(maxWidth: .infinity, minHeight: 60)
                                .background(CueTheme.card(for: colorScheme))
                                .foregroundColor(CueTheme.ink(for: colorScheme))
                                .clipShape(RoundedRectangle(cornerRadius: 18))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 18)
                                        .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                                )
                        }
                    }
                }
                .frame(maxWidth: 320)

                Spacer()
            }
            .padding(CueTheme.space3)
        }
        .onAppear {
            pin = ""
            confirmPin = ""
            step = 1
            errorMessage = nil
        }
    }

    private var currentInput: String {
        step == 1 ? pin : confirmPin
    }

    private func pinKey(_ digit: String) -> some View {
        Button {
            HapticsService.light()
            errorMessage = nil
            if step == 1 {
                if pin.count < 4 {
                    pin.append(digit)
                    if pin.count == 4 {
                        handleStep1Completed()
                    }
                }
            } else {
                if confirmPin.count < 4 {
                    confirmPin.append(digit)
                    if confirmPin.count == 4 {
                        handleStep2Completed()
                    }
                }
            }
        } label: {
            Text(digit)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .frame(maxWidth: .infinity, minHeight: 60)
                .background(CueTheme.card(for: colorScheme))
                .foregroundColor(CueTheme.ink(for: colorScheme))
                .clipShape(RoundedRectangle(cornerRadius: 18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18)
                        .stroke(CueTheme.line(for: colorScheme), lineWidth: 1)
                )
        }
    }

    private func handleStep1Completed() {
        if isSettingNewPin {
            step = 2
        } else {
            // Verify existing PIN
            if viewModel.unlockWithPin(pin) {
                HapticsService.success()
            } else {
                HapticsService.buzz()
                errorMessage = "Incorrect PIN. Try again."
                pin = ""
            }
        }
    }

    private func handleStep2Completed() {
        if pin == confirmPin {
            if KeychainService.savePin(pin) {
                HapticsService.success()
                pin = ""
                confirmPin = ""
                step = 1
                viewModel.isUnlocked = true
            } else {
                HapticsService.buzz()
                errorMessage = "Failed to save PIN securely. Please try again."
                pin = ""
                confirmPin = ""
                step = 1
            }
        } else {
            HapticsService.buzz()
            errorMessage = "PINs do not match. Try again."
            pin = ""
            confirmPin = ""
            step = 1
        }
    }
}
