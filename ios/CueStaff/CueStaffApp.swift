import SwiftUI
import CueCore

@main
struct CueStaffApp: App {
    var body: some Scene {
        WindowGroup {
            StaffSessionView()
                .cueUpdateGate(.staff)
        }
    }
}

private struct StaffSessionView: View {
    @State private var isCheckingSession = true
    @State private var isAuthenticated = false
    @State private var email = ""
    @State private var password = ""
    @State private var errorMessage: String?
    @State private var isSigningIn = false

    var body: some View {
        Group {
            if !StoreFactory.hasFirebaseConfig() || isAuthenticated {
                CueStaffContentView()
            } else if isCheckingSession {
                ProgressView("Checking staff access…")
            } else {
                signInView
            }
        }
        .task {
            guard StoreFactory.hasFirebaseConfig(), isCheckingSession else { return }
            do {
                isAuthenticated = try await StoreFactory.restoreStaffSession()
            } catch {
                errorMessage = error.localizedDescription
            }
            isCheckingSession = false
        }
    }

    private var signInView: some View {
        VStack(spacing: 20) {
            Spacer()
            CueLogoView(size: 64, cornerRadius: 16)
            Text("Staff sign in")
                .font(.system(size: 28, weight: .heavy))
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .textFieldStyle(.roundedBorder)
            SecureField("Password", text: $password)
                .textContentType(.password)
                .textFieldStyle(.roundedBorder)
            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
                    .multilineTextAlignment(.center)
            }
            Button(isSigningIn ? "Signing in…" : "Sign in") {
                Task {
                    isSigningIn = true
                    errorMessage = nil
                    do {
                        try await StoreFactory.signInStaff(email: email, password: password)
                        password = ""
                        isAuthenticated = true
                    } catch {
                        errorMessage = error.localizedDescription
                    }
                    isSigningIn = false
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(isSigningIn || email.isEmpty || password.isEmpty)
            Spacer()
        }
        .padding(24)
    }
}
