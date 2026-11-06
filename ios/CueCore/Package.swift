// swift-tools-version: 5.9
// xcode: set sdk=iOS
import PackageDescription

let package = Package(
    name: "CueCore",
    defaultLocalization: "en",
    platforms: [
        .iOS(.v16)
    ],
    products: [
        .library(
            name: "CueCore",
            targets: ["CueCore"]
        )
    ],
    dependencies: [
        .package(
            url: "https://github.com/firebase/firebase-ios-sdk.git",
            .upToNextMajor(from: "10.20.0")
        )
    ],
    targets: [
        .target(
            name: "CueCore",
            dependencies: [
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk")
            ],
            path: "Sources/CueCore"
        ),
        .testTarget(
            name: "CueCoreTests",
            dependencies: ["CueCore"],
            path: "Tests/CueCoreTests"
        )
    ]
)
