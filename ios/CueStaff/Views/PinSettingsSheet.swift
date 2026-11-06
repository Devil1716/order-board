import SwiftUI
import CueCore

public struct PinSettingsSheet: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme
    @State private var pinEnabled: Bool = KeychainService.isPinEnabled
    @State private var showChangePin: Bool = false
    @State private var newPin: String = ""
    @State private var confirmPin: String = ""
    @State private var statusMsg: String?

    public init(viewModel: CueStaffViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            Form {
                Section(header: Text("Staff Security")) {
                    Toggle("PIN Protection", isOn: $pinEnabled)
                        .onChange(of: pinEnabled) { newValue in
                            KeychainService.isPinEnabled = newValue
                            if newValue && !KeychainService.hasPin() {
                                showChangePin = true
                            }
                        }

                    if KeychainService.hasPin() {
                        Button("Change PIN") {
                            showChangePin = true
                        }

                        Button("Remove PIN", role: .destructive) {
                            KeychainService.deletePin()
                            KeychainService.isPinEnabled = false
                            pinEnabled = false
                        }
                    }
                }

                if showChangePin {
                    Section(header: Text("Set New 4-Digit PIN")) {
                        SecureField("New PIN", text: $newPin)
                            .keyboardType(.numberPad)
                        SecureField("Confirm PIN", text: $confirmPin)
                            .keyboardType(.numberPad)

                        if let status = statusMsg {
                            Text(status)
                                .font(.footnote)
                                .foregroundColor(CueTheme.red)
                        }

                        Button("Save PIN") {
                            guard newPin.count == 4, newPin.allSatisfy({ "0123456789".contains($0) }) else {
                                statusMsg = "PIN must be exactly 4 digits (0-9)."
                                return
                            }
                            guard newPin == confirmPin else {
                                statusMsg = "PINs do not match."
                                return
                            }
                            KeychainService.savePin(newPin)
                            KeychainService.isPinEnabled = true
                            pinEnabled = true
                            showChangePin = false
                            newPin = ""
                            confirmPin = ""
                            statusMsg = nil
                        }
                        .fontWeight(.bold)
                    }
                }

                Section(header: Text("Sync Status")) {
                    Text(viewModel.syncLabel)
                        .font(.footnote)
                        .foregroundColor(CueTheme.mute(for: colorScheme))
                }
            }
            .navigationTitle("Staff Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }
}
