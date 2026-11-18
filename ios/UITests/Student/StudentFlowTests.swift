import XCTest

/// Student app in LOCAL mode (no Firebase). Orders are seeded through the `ob-orders-v1`
/// launch argument (read by LocalBoardStore), since local mode cannot see the staff phone.
final class StudentFlowTests: CueUITestCase {

    private func seededOrders() -> String {
        let n = nowMs
        // 12 and 15 preparing, 7 ready 20 s ago, 3 ready 1 min ago.
        return "[{\"n\":12,\"t\":\(n - 6 * 60_000),\"r\":0,\"c\":0},"
            + "{\"n\":15,\"t\":\(n - 2 * 60_000),\"r\":0,\"c\":0},"
            + "{\"n\":7,\"t\":\(n - 9 * 60_000),\"r\":\(n - 20_000),\"c\":0},"
            + "{\"n\":3,\"t\":\(n - 12 * 60_000),\"r\":\(n - 60_000),\"c\":0}]"
    }

    func test1_TrackTokensBoardAndThemes() throws {
        try XCTSkipIf(isFirebaseRun, "local-mode test")
        launch(["-ob-orders-v1", seededOrders()])

        XCTAssertTrue(app.staticTexts["Enter your token"].waitForExistence(timeout: 15), "Empty entry screen")
        shot("student-01-enter-token-light")
        assertNoRangeText()

        let field = app.textFields["000"]
        XCTAssertTrue(field.exists, "Token field")
        field.tap()
        field.typeText("12")
        shot("student-02-typed-12")
        app.buttons["Track my order"].tap()
        allowSystemAlertIfShown()

        XCTAssertTrue(app.staticTexts["Your order"].waitForExistence(timeout: 10), "Tracking card after Track")
        XCTAssertTrue(app.staticTexts["Preparing"].exists || app.staticTexts["You’re next"].exists, "Token 12 shows a preparing state")
        shot("student-03-tracking-12-preparing")

        // Students must never be able to mark an order collected.
        let collectButtons = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'collect'"))
        XCTAssertEqual(collectButtons.count, 0, "Student UI must not offer a collected button")

        // Track a second token that is already ready: full-screen alert.
        let add = app.textFields["000"]
        if add.waitForExistence(timeout: 5) {
            add.tap()
            add.typeText("7")
            app.buttons["Add order"].tap()
        }
        let alert = app.staticTexts["Your order is ready"]
        XCTAssertTrue(alert.waitForExistence(timeout: 10), "Ready alert for token 7")
        shot("student-04-ready-alert-7")
        XCTAssertEqual(app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'collect'")).count, 0,
                       "Ready alert must not offer a collected button")
        if app.buttons["Got it"].exists { app.buttons["Got it"].tap() }
        shot("student-05-two-orders")
        app.swipeUp()
        shot("student-06-two-orders-scrolled")

        // Board view
        app.swipeDown()
        let board = app.buttons["Board View"]
        if board.waitForExistence(timeout: 5) { board.tap() }
        shot("student-07-board-light")
        assertNoRangeText()

        // Dark theme
        let toggle = app.buttons["Light"]
        XCTAssertTrue(toggle.exists, "Theme toggle")
        toggle.tap()
        XCTAssertTrue(app.buttons["Dark"].waitForExistence(timeout: 5), "Theme switched to Dark")
        shot("student-08-board-dark")
        app.buttons["My Orders"].tap()
        shot("student-09-my-orders-dark")

        // Settings page: Cue's rule is logo + gear in the header, theme inside settings.
        let gear = app.buttons.matching(NSPredicate(format: "label CONTAINS[c] 'setting' OR identifier CONTAINS[c] 'setting'")).firstMatch
        designRule(gear.exists, "Student header has a gear that opens a settings page")
        designRule(!(app.buttons["Light"].exists || app.buttons["Dark"].exists),
                   "Student header is logo + gear only (theme toggle lives in settings)")

        // Clean up so the next run starts empty.
        while app.buttons["Remove"].firstMatch.exists {
            app.buttons["Remove"].firstMatch.tap()
            sleep(1)
        }
        XCTAssertTrue(app.staticTexts["Enter your token"].waitForExistence(timeout: 5), "Back to empty entry")
        shot("student-10-enter-token-dark")
    }

    func test2_UpdateRequiredGate() throws {
        try XCTSkipIf(isFirebaseRun, "local-mode test")
        launch(["-cueDebugMinVersion", "99.0", "-cueDebugAnnouncement", "Canteen closes at 4 pm today"])
        XCTAssertTrue(app.staticTexts["Update required"].waitForExistence(timeout: 15), "Forced update screen")
        XCTAssertTrue(app.buttons["Update"].exists, "Update button")
        shot("student-11-update-required")
    }
}

/// Runs only in the Firebase job (real GoogleService-Info plist); read-only, writes nothing.
final class StudentFirebaseSmokeTests: CueUITestCase {
    func testLiveBoardLoads() throws {
        try XCTSkipUnless(isFirebaseRun, "needs the Firebase plist")
        launch()
        XCTAssertTrue(app.staticTexts["Enter your token"].waitForExistence(timeout: 20))
        sleep(8)
        XCTAssertFalse(element(containing: "On this phone only").exists, "Should be synced with Firebase, not local mode")
        shot("student-fb-01-my-orders")
        if app.buttons["Board View"].exists { app.buttons["Board View"].tap() }
        sleep(3)
        shot("student-fb-02-live-board")
    }
}
