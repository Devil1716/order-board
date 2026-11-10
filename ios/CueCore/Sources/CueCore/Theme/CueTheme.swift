import SwiftUI

/// Brand design tokens with accessible, high-contrast dark and light modes.
public struct CueTheme {
    // Brand primary red
    public static let red = Color(hex: "#e60023")
    public static let redInk = Color(hex: "#ffffff")

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
        public static let tileBg = Color(hex: "#cfcfcf")
        public static let readyTileBg = Color(hex: "#d8d8d8")
    }

    // Dark mode palette (designed for OLED black background with elevated readable cards)
    public struct Dark {
        public static let bg = Color(hex: "#0a0a0a")
        public static let ink = Color(hex: "#f4f4f6")
        public static let mute = Color(hex: "#9c9ca4")
        public static let card = Color(hex: "#18181b")
        public static let line = Color(hex: "#2e2e34")
        public static let tileBg = Color(hex: "#26262b")
        public static let readyTileBg = Color(hex: "#2f2f35")
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

    public static func tileBg(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.tileBg : Light.tileBg
    }

    public static func readyTileBg(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.readyTileBg : Light.readyTileBg
    }

    public static func cardInk(for scheme: ColorScheme) -> Color {
        scheme == .dark ? Dark.ink : Light.ink
    }
}
