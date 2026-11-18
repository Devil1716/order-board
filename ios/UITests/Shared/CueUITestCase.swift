import XCTest

/// Shared helpers: named screenshots (written to $CUE_SHOT_DIR and attached to the xcresult),
/// the iOS notification prompt, and Cue design-rule checks.
class CueUITestCase: XCTestCase {
    var app: XCUIApplication!

    private var env: [String: String] { ProcessInfo.processInfo.environment }
    var deviceTag: String { env["CUE_DEVICE_TAG"] ?? "device" }
    var isFirebaseRun: Bool { env["CUE_MODE"] == "firebase" }

    override func setUp() {
        super.setUp()
        continueAfterFailure = true
    }

    func launch(_ args: [String] = [], theme: String = "light", env: [String: String] = [:]) {
        app = XCUIApplication()
        app.launchArguments = ["-ob-theme", theme] + args
        app.launchEnvironment = env
        app.launch()
    }

    /// Opens settings from the header gear, picks a theme, takes a screenshot, closes it.
    func setTheme(_ mode: String, shotName: String? = nil, file: StaticString = #filePath, line: UInt = #line) {
        let gear = app.buttons["Settings"]
        XCTAssertTrue(gear.waitForExistence(timeout: 5), "Header gear", file: file, line: line)
        gear.tap()
        let seg = app.buttons[mode]
        XCTAssertTrue(seg.waitForExistence(timeout: 5), "Appearance option \(mode) in settings", file: file, line: line)
        seg.tap()
        if let shotName { shot(shotName) }
        app.buttons["Done"].tap()
        sleep(1)
    }

    /// Cue rule: the header holds only the logo and the gear.
    func checkHeaderRule(_ appLabel: String) {
        designRule(app.buttons["Settings"].exists, "\(appLabel) header has a gear that opens settings")
        let extras = ["Light", "Dark", "Sound on", "Sound off", "My Orders", "Board View"].filter { app.buttons[$0].exists }
        designRule(extras.isEmpty, "\(appLabel) header is logo + gear only (extra controls: \(extras))")
    }

    var nowMs: Int64 { Int64(Date().timeIntervalSince1970 * 1000) }

    func shot(_ name: String, file: StaticString = #filePath, line: UInt = #line) {
        sleep(1) // let animations settle
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = "\(deviceTag)-\(name)"
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["CUE_SHOT_DIR"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir, isDirectory: true)
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: url.appendingPathComponent("\(deviceTag)-\(name).png"))
        }
    }

    /// Taps "Allow" on the system notification prompt if it shows up.
    func allowSystemAlertIfShown(timeout: TimeInterval = 5) {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        for label in ["Allow", "OK"] {
            let button = springboard.buttons[label]
            if button.waitForExistence(timeout: timeout) {
                button.tap()
                return
            }
        }
    }

    func element(containing text: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS[c] %@", text)).firstMatch
    }

    /// Records a Cue design-rule check in design-rules.txt without failing the functional test.
    func designRule(_ ok: Bool, _ rule: String) {
        let line = "\(ok ? "PASS" : "FAIL") [\(deviceTag)] \(rule)\n"
        XCTContext.runActivity(named: "Design rule: \(line)") { _ in }
        if let dir = env["CUE_SHOT_DIR"], !dir.isEmpty {
            let url = URL(fileURLWithPath: dir).appendingPathComponent("design-rules.txt")
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            if let h = try? FileHandle(forWritingTo: url) {
                h.seekToEndOfFile(); h.write(line.data(using: .utf8)!); try? h.close()
            } else {
                try? line.data(using: .utf8)!.write(to: url)
            }
        }
    }

    func assertNoRangeText(file: StaticString = #filePath, line: UInt = #line) {
        for bad in ["1-200", "1–200", "1 - 200"] {
            XCTAssertFalse(element(containing: bad).exists, "Range text '\(bad)' is visible", file: file, line: line)
        }
    }
}
