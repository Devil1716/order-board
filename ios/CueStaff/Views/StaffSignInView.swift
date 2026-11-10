import SwiftUI
import CueCore

struct StaffSignInView: View {
    @ObservedObject var viewModel: CueStaffViewModel
    @State private var email = ""
    @State private var password = ""
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ZStack {
            CueTheme.bg(for: colorScheme).ignoresSafeArea()

            VStack(spacing: 20) {
                Spacer()
                CueLogoView(size: 64, cornerRadius: 16)
                Text("Staff sign in")
                    .font(.system(size: 28, weight: .heavy))
                    .foregroundColor(CueTheme.ink(for: colorScheme))

                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .textFieldStyle(.roundedBorder)

                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .textFieldStyle(.roundedBorder)

                if let error = viewModel.signInError {
                    Text(error)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(CueTheme.red)
                        .multilineTextAlignment(.center)
                }

                Button {
                    Task { await viewModel.signInStaff(email: email, password: password) }
                } label: {
                    Text(viewModel.isSigningIn ? "Signing in…" : "Sign in")
                        .font(.system(size: 17, weight: .bold))
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(CueTheme.red)
                        .foregroundColor(.white)
                        .clipShape(Capsule())
                }
                .disabled(viewModel.isSigningIn || email.isEmpty || password.isEmpty)

                Spacer()
            }
            .padding(CueTheme.space3)
            .frame(maxWidth: 420)
        }
    }
}
