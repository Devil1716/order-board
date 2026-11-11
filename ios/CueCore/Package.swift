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
            url: "https://github.com/apple/swift-protobuf.git",
            "1.26.0"..<"1.29.0"
        ),
        .package(
            url: "https://github.com/firebase/firebase-ios-sdk.git",
            .upToNextMajor(from: "10.20.0")
        )
    ],
    targets: [
        .target(
            name: "CueCore",
            dependencies: [
                .product(name: "FirebaseAuth", package: "firebase-ios-sdk"),
                .product(name: "FirebaseFirestore", package: "firebase-ios-sdk"),
                .product(name: "FirebaseRemoteConfig", package: "firebase-ios-sdk")
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
