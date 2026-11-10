import SwiftUI
import CueCore

public struct ToastOverlayView: View {
    let message: String
    let showUndo: Bool
    let onUndo: () -> Void
    @Environment(\.colorScheme) private var colorScheme

    public var body: some View {
        HStack(spacing: 12) {
            Text(message)
                .font(.system(size: 15, weight: .bold))
                .foregroundColor(CueTheme.bg(for: colorScheme))

            if showUndo {
                Button {
                    onUndo()
                } label: {
                    Text("Undo")
                        .font(.system(size: 14, weight: .heavy))
                        .padding(.horizontal, 14)
                        .padding(.vertical, 6)
                        .background(CueTheme.red)
                        .foregroundColor(CueTheme.redInk)
                        .clipShape(Capsule())
                }
            }
        }
        .padding(.leading, 18)
        .padding(.trailing, showUndo ? 8 : 18)
        .padding(.vertical, 10)
        .background(CueTheme.ink(for: colorScheme))
        .clipShape(Capsule())
        .shadow(color: Color.black.opacity(0.18), radius: 12, x: 0, y: 6)
        .padding(.horizontal, 16)
        .padding(.bottom, 16)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: message)
    }
}
