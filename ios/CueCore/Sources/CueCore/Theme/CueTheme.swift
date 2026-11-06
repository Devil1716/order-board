import SwiftUI

/// Brand design tokens extracted directly from `shared/css/styles.css`
public struct CueTheme {
    // Brand primary red
    public static let red = Color(hex: "#e60023")
    public static let redInk = Color(hex: "#ffffff")

    // Semantic palette tints (used for tiles, chips, secondary cards)
    public static let p0 = Color(hex: "#f0d0d0")
    public static let p1 = Color(hex: "#d8d8d8")
    public static let p2 = Color(hex: "#cfcfcf")
    public static let p3 = Color(hex: "#c4c4c4")
    public static let p4 = Color(hex: "#bababa")
    public static let p5 = Color(hex: "#e0d4d4")
    public static let cardInk = Color(hex: "#1a1a1a") // --pi

    // Spacing scale
    public static let space1: CGFloat = 8
    public static let space2: CGFloat = 12
    public static let space3: CGFloat = 16
    public static let space4: CGFloat = 20
    public static let gutter: CGFloat = 16

    // Corner radiuses
    public static let radiusCard: CGFloat = 28
    public static let radiusPanel: CGFloat = 28
    public static let radiusButton: CGFloat = 999
    public static let radiusTile: CGFloat = 24

    // Light mode palette
    public struct Light {
        public static let bg = Color(hex: "#f0f0f0")
        public static let ink = Color(hex: "#111111")
        public static let mute = Color(hex: "#666666")
        public static let card = Color(hex: "#ffffff")
        public static let line = Color(hex: "#d0d0d0")
        public static let primaryInk = Color(hex: "#1a1a1a")
    }

    // Dark mode palette
    public struct Dark {
        public static let bg = Color(hex: "#0a0a0a")
        public static let ink = Color(hex: "#f0f0f0")
        public static let mute = Color(hex: "#8a8a8a")
        public static let card = Color(hex: "#e0e0e0")
        public static let line = Color(hex: "#c8c8c8")
        public static let primaryInk = Color(hex: "#1a1a1a")
    }

    // Context-sensitive colors based on color scheme
    public static func bg(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.bg : Light.bg
    }

    public static func ink(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.ink : Light.ink
    }

    public static func mute(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.mute : Light.mute
    }

    public static func card(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.card : Light.card
    }

    public static func line(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.line : Light.line
    }
}
