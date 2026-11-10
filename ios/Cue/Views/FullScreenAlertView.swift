import SwiftUI
import CueCore

public struct FullScreenAlertView: View {
    let token: Int
    let onDismiss: () -> Void

    public var body: some View {
        ZStack {
            CueTheme.red
                .ignoresSafeArea()

            VStack(spacing: 12) {
                Spacer()

                Text("Your order is ready")
                    .font(.system(size: 32, weight: .heavy))
                    .foregroundColor(CueTheme.redInk)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)

                Text("\(token)")
                    .font(.system(size: 140, weight: .heavy, design: .rounded))
                    .monospacedDigit()
                    .foregroundColor(CueTheme.redInk)
                    .lineLimit(1)
                    .minimumScaleFactor(0.4)
                    .padding(.vertical, 8)

                Text("Please collect it from the counter.")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundColor(CueTheme.redInk.opacity(0.95))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                Spacer()

                Button {
                    onDismiss()
                } label: {
                    Text("Got it")
                        .font(.system(size: 22, weight: .heavy))
                        .frame(maxWidth: 320, minHeight: 60)
                        .background(CueTheme.redInk)
                        .foregroundColor(CueTheme.red)
                        .clipShape(Capsule())
                        .shadow(color: Color.black.opacity(0.12), radius: 8, x: 0, y: 4)
                }
                .padding(.bottom, 40)
            }
            .padding(.horizontal, CueTheme.gutter)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Order ready alert. Token \(token). Please collect it from the counter.")
    }
}
