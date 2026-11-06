import SwiftUI

#if canImport(UIKit)
import UIKit
#endif

/// Reusable brand logo view with graceful fallback
public struct CueLogoView: View {
    public let size: CGFloat
    public let cornerRadius: CGFloat

    public init(size: CGFloat = 36, cornerRadius: CGFloat = 10) {
        self.size = size
        self.cornerRadius = cornerRadius
    }

    public var body: some View {
        Group {
            #if canImport(UIKit)
            if let uiImage = UIImage(named: "Logo") ?? UIImage(named: "logo") {
                Image(uiImage: uiImage)
                    .resizable()
                    .scaledToFit()
            } else {
                fallbackMark
            }
            #else
            Image("Logo")
                .resizable()
                .scaledToFit()
            #endif
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .overlay(
            RoundedRectangle(cornerRadius: cornerRadius)
                .stroke(Color.black.opacity(0.08), lineWidth: 1)
        )
    }

    private var fallbackMark: some View {
        ZStack {
            CueTheme.red
            Text("C")
                .font(.system(size: size * 0.58, weight: .heavy, design: .rounded))
                .foregroundColor(CueTheme.redInk)
        }
    }
}
