import XCTest

/// Staff app in LOCAL mode (no Firebase): issue, mark ready, hand over, settings, themes.
final class StaffFlowTests: CueUITestCase {

    private func key(_ k: String) { app.buttons[k].firstMatch.tap() }

    private func unlockIfNeeded() {
        if app.staticTexts["Set Staff PIN"].waitForExistence(timeout: 10) {
            shot("staff-01-set-pin")
            app.buttons["Skip"].tap()
        } else if app.staticTexts["Enter Staff PIN"].exists {
            XCTFail("Staff app is PIN-locked from a previous run")
        }
    }

    func test1_IssueReadyHandOverSettingsThemes() throws {
        try XCTSkipIf(isFirebaseRun, "local-mode test")
        launch()
        unlockIfNeeded()

        XCTAssertTrue(app.staticTexts["Cue Staff"].waitForExistence(timeout: 10), "Staff main screen")
        shot("staff-02-empty-light")
        assertNoRangeText()
        checkHeaderRule("Staff")

        // Give next token (auto numbering)
        app.buttons["Give this token"].tap()
        XCTAssertTrue(element(containing: "Give customer token").waitForExistence(timeout: 5), "Give-token toast")
        shot("staff-03-gave-next-token")

        // Type a token on the keypad and add it
        key("4"); key("2")
        XCTAssertTrue(app.buttons["Add token 42"].waitForExistence(timeout: 3), "Adaptive button = Add token 42")
        shot("staff-04-typed-42")
        app.buttons["Add token 42"].tap()
        XCTAssertTrue(element(containing: "Token 42 added").waitForExistence(timeout: 5), "Add toast")
        XCTAssertTrue(element(containing: "Up next · 2").waitForExistence(timeout: 5), "Two orders preparing")
        shot("staff-05-two-preparing")

        // Mark 42 ready via keypad
        key("4"); key("2")
        XCTAssertTrue(app.buttons["Ready: 42"].waitForExistence(timeout: 3), "Adaptive button = Ready: 42")
        app.buttons["Ready: 42"].tap()
        XCTAssertTrue(element(containing: "Token 42 is ready").waitForExistence(timeout: 5), "Ready toast")
        app.swipeUp()
        shot("staff-06-42-ready-scrolled")

        // Hand over via the ready tile
        let tile = app.buttons["Token 42 handed over"]
        XCTAssertTrue(tile.waitForExistence(timeout: 5), "Ready tile for 42")
        tile.tap()
        XCTAssertTrue(element(containing: "Token 42 taken off").waitForExistence(timeout: 5), "Hand-over toast")
        shot("staff-07-handed-over-toast")
        if app.buttons["Undo"].exists {
            app.buttons["Undo"].tap()
            XCTAssertTrue(app.buttons["Token 42 handed over"].waitForExistence(timeout: 5), "Undo brings 42 back to ready")
            shot("staff-08-undo-restored")
        }
        app.swipeDown()

        // Quick "Mark oldest ready"
        let quick = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Mark '")).firstMatch
        if quick.exists { quick.tap(); sleep(1) }
        shot("staff-09-after-quick-ready")

        // Settings page from the gear
        app.buttons["Settings"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 5), "Settings sheet")
        shot("staff-10-settings-light")
        app.buttons["Done"].tap()

        // Dark theme (chosen in settings)
        setTheme("Dark", shotName: "staff-11-settings-dark")
        shot("staff-12-dark")
        app.swipeUp()
        shot("staff-13-dark-scrolled")
        app.swipeDown()
        setTheme("Light") // back to light for the next run
    }

    func test2_UpdateRequiredGate() throws {
        try XCTSkipIf(isFirebaseRun, "local-mode test")
        launch(["-cueDebugMinVersion", "99.0"])
        XCTAssertTrue(app.staticTexts["Update required"].waitForExistence(timeout: 15), "Forced update screen")
        shot("staff-14-update-required")
    }
}

/// Firebase job only: confirms the staff app asks for a staff sign-in (does not sign in).
final class StaffFirebaseSmokeTests: CueUITestCase {
    func testStaffSignInShown() throws {
        try XCTSkipUnless(isFirebaseRun, "needs the Firebase plist")
        launch()
        XCTAssertTrue(app.staticTexts["Staff sign in"].waitForExistence(timeout: 25), "Staff sign-in screen")
        shot("staff-fb-01-sign-in")
    }
}
