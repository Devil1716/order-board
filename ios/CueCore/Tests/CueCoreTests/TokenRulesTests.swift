import XCTest
@testable import CueCore

final class TokenRulesTests: XCTestCase {

    func testTokenValidation() {
        XCTAssertTrue(TokenRules.isValidToken(1))
        XCTAssertTrue(TokenRules.isValidToken(75))
        XCTAssertTrue(TokenRules.isValidToken(200))

        XCTAssertFalse(TokenRules.isValidToken(0))
        XCTAssertFalse(TokenRules.isValidToken(-1))
        XCTAssertFalse(TokenRules.isValidToken(201))
        XCTAssertFalse(TokenRules.isValidToken(999))
    }

    func testStaleWindow4Hours() {
        let now: Int64 = 1_000_000_000
        let fourHoursMs: Int64 = 4 * 3600 * 1000

        // Order created 3 hours ago -> not stale
        let freshOrder = Order(token: 10, createdMs: now - (3 * 3600 * 1000))
        XCTAssertFalse(TokenRules.isStale(order: freshOrder, nowMs: now))

        // Order created exactly 4 hours ago -> not stale
        let edgeOrder = Order(token: 11, createdMs: now - fourHoursMs)
        XCTAssertFalse(TokenRules.isStale(order: edgeOrder, nowMs: now))

        // Order created 4 hours and 1 second ago -> stale!
        let staleOrder = Order(token: 12, createdMs: now - fourHoursMs - 1000)
        XCTAssertTrue(TokenRules.isStale(order: staleOrder, nowMs: now))
    }

    func testReadyExpiry20Minutes() {
        let now: Int64 = 1_000_000_000

        // Order ready 5 minutes ago -> in ready view
        let recentReady = Order(token: 20, createdMs: now - 600_000, readyMs: now - 300_000)
        // Order ready 19 minutes ago -> in ready view
        let almostExpired = Order(token: 21, createdMs: now - 1_200_000, readyMs: now - (19 * 60 * 1000))
        // Order ready 21 minutes ago -> expired, not in ready view
        let expired = Order(token: 22, createdMs: now - 1_300_000, readyMs: now - (21 * 60 * 1000))

        let view = TokenRules.computeView(orders: [recentReady, almostExpired, expired], nowMs: now)
        XCTAssertEqual(view.ready.map(\.token), [20, 21])
        XCTAssertFalse(view.ready.contains(where: { $0.token == 22 }))
    }

    func testQueueSorting() {
        let now: Int64 = 1_000_000_000

        // Prep orders created at different times
        let prepOldest = Order(token: 1, createdMs: now - 5000, readyMs: 0)
        let prepMiddle = Order(token: 2, createdMs: now - 3000, readyMs: 0)
        let prepNewest = Order(token: 3, createdMs: now - 1000, readyMs: 0)

        // Ready orders ready at different times
        let readyOlder = Order(token: 4, createdMs: now - 10000, readyMs: now - 4000)
        let readyNewer = Order(token: 5, createdMs: now - 8000, readyMs: now - 1000)

        let view = TokenRules.computeView(
            orders: [prepNewest, readyOlder, prepOldest, readyNewer, prepMiddle],
            nowMs: now
        )

        // Prep: ascending creation time (oldest first: 1, 2, 3)
        XCTAssertEqual(view.preparing.map(\.token), [1, 2, 3])

        // Ready: descending ready time (newest ready first: 5, 4)
        XCTAssertEqual(view.ready.map(\.token), [5, 4])
    }

    func testCollectedOrdersOmittedFromView() {
        let now: Int64 = 1_000_000_000

        let preparing = Order(token: 1, createdMs: now - 1000, readyMs: 0, collectedMs: 0)
        let ready = Order(token: 2, createdMs: now - 2000, readyMs: now - 500, collectedMs: 0)
        let collected = Order(token: 3, createdMs: now - 3000, readyMs: now - 1500, collectedMs: now - 100)

        let view = TokenRules.computeView(orders: [preparing, ready, collected], nowMs: now)
        XCTAssertEqual(view.preparing.map(\.token), [1])
        XCTAssertEqual(view.ready.map(\.token), [2])
        XCTAssertFalse(view.preparing.contains(where: { $0.token == 3 }))
        XCTAssertFalse(view.ready.contains(where: { $0.token == 3 }))
    }

    func testNextAvailableTokenReusesFreedNumbersAndWraps() {
        let now: Int64 = 1_000_000_000

        // Suppose tokens 1, 2, 3 are currently in prep/ready
        let o1 = Order(token: 1, createdMs: now - 1000, readyMs: 0)
        let o2 = Order(token: 2, createdMs: now - 2000, readyMs: now - 500)
        let o3 = Order(token: 3, createdMs: now - 3000, readyMs: 0)

        // Token 4 should be recommended if starting at 1
        XCTAssertEqual(TokenRules.nextAvailableToken(currentOrders: [o1, o2, o3], start: 1, nowMs: now), 4)

        // If start is 2, candidate 2 and 3 used -> returns 4
        XCTAssertEqual(TokenRules.nextAvailableToken(currentOrders: [o1, o2, o3], start: 2, nowMs: now), 4)

        // If start is 200 and 200 is free -> returns 200
        XCTAssertEqual(TokenRules.nextAvailableToken(currentOrders: [o1, o2, o3], start: 200, nowMs: now), 200)

        // If 200 is in prep, wrapping around back to 1 (which is used) and finding free token 4
        let o200 = Order(token: 200, createdMs: now - 1000, readyMs: 0)
        XCTAssertEqual(TokenRules.nextAvailableToken(currentOrders: [o1, o2, o3, o200], start: 200, nowMs: now), 4)

        // If all 200 tokens were in use -> returns 0
        var allOrders: [Order] = []
        for i in 1...200 {
            allOrders.append(Order(token: i, createdMs: now - 1000, readyMs: 0))
        }
        XCTAssertEqual(TokenRules.nextAvailableToken(currentOrders: allOrders, start: 1, nowMs: now), 0)
    }

    func testAgeFormatting() {
        XCTAssertEqual(TokenRules.formatAge(elapsedMs: 20_000), "Just now")
        XCTAssertEqual(TokenRules.formatAge(elapsedMs: 60_000), "1 min")
        XCTAssertEqual(TokenRules.formatAge(elapsedMs: 120_000), "2 min")
        XCTAssertEqual(TokenRules.formatAge(elapsedMs: 3_600_000), "60 min")

        XCTAssertEqual(TokenRules.formatCompactAge(elapsedMs: 20_000), "<1m")
        XCTAssertEqual(TokenRules.formatCompactAge(elapsedMs: 60_000), "1m")
        XCTAssertEqual(TokenRules.formatCompactAge(elapsedMs: 300_000), "5m")
    }
}

// MARK: - isTaken (parity with `isTaken` in shared/js/token-rules.js)

final class TokenTakenTests: XCTestCase {
    private let now: Int64 = 1_000_000_000_000

    override func tearDown() {
        TokenRules.resetRemote()
        super.tearDown()
    }

    func testMissingOrderIsFree() {
        XCTAssertFalse(TokenRules.isTaken(nil, nowMs: now))
    }

    func testPreparingOrderIsTaken() {
        XCTAssertTrue(TokenRules.isTaken(Order(token: 5, createdMs: now - 60_000), nowMs: now))
    }

    func testCollectedOrderIsFree() {
        XCTAssertFalse(TokenRules.isTaken(Order(token: 5, createdMs: now - 60_000, readyMs: now - 30_000, collectedMs: now - 10_000), nowMs: now))
    }

    func testStaleOrderIsFree() {
        let fourHours: Int64 = 4 * 3600 * 1000
        XCTAssertTrue(TokenRules.isTaken(Order(token: 5, createdMs: now - fourHours), nowMs: now))
        XCTAssertFalse(TokenRules.isTaken(Order(token: 5, createdMs: now - fourHours - 1), nowMs: now))
    }

    func testReadyOrderHoldsTokenForTwentyMinutes() {
        let created = now - 3_000_000
        XCTAssertTrue(TokenRules.isTaken(Order(token: 5, createdMs: created, readyMs: now - 20 * 60_000), nowMs: now))
        XCTAssertFalse(TokenRules.isTaken(Order(token: 5, createdMs: created, readyMs: now - 20 * 60_000 - 1), nowMs: now))
    }

    func testRemoteThresholdsCanLengthenButNeverShorten() {
        TokenRules.applyRemote(expiryMinutes: 5, staleWindowHours: 1)
        XCTAssertEqual(TokenRules.defaultExpiryMinutes, 20, "shorter than the rules value is ignored")
        XCTAssertEqual(TokenRules.staleWindowHours, 4)

        TokenRules.applyRemote(expiryMinutes: 30, staleWindowHours: 6)
        XCTAssertEqual(TokenRules.defaultExpiryMinutes, 30)
        XCTAssertEqual(TokenRules.staleWindowHours, 6)

        TokenRules.applyRemote(expiryMinutes: 9999, staleWindowHours: 9999)
        XCTAssertEqual(TokenRules.defaultExpiryMinutes, 120)
        XCTAssertEqual(TokenRules.staleWindowHours, 24)

        TokenRules.applyRemote(expiryMinutes: nil, staleWindowHours: nil)
        XCTAssertEqual(TokenRules.defaultExpiryMinutes, 20)
        XCTAssertEqual(TokenRules.staleWindowHours, 4)
    }
}

// MARK: - Remote settings (Firebase-free logic)

final class RemoteSettingsTests: XCTestCase {
    override func tearDown() {
        TokenRules.resetRemote()
        super.tearDown()
    }

    func testVersionCompare() {
        XCTAssertEqual(VersionCompare.compare("1.0.0", "1.0.0"), 0)
        XCTAssertEqual(VersionCompare.compare("1.0", "1.0.0"), 0)
        XCTAssertEqual(VersionCompare.compare("1.9.2", "1.10.0"), -1)
        XCTAssertEqual(VersionCompare.compare("2.0", "1.99.99"), 1)
        XCTAssertTrue(VersionCompare.isLess("1.0", than: "1.0.1"))
        XCTAssertFalse(VersionCompare.isLess("1.0.1", than: "1.0"))
    }

    func testUpdateRequiredUsesPerAppMinimum() {
        let s = RemoteSettings(values: [
            RemoteSettings.Key.minVersionStudent: "1.2.0",
            RemoteSettings.Key.minVersionStaff: ""
        ])
        XCTAssertTrue(s.updateRequired(for: .student, installedVersion: "1.1.9"))
        XCTAssertFalse(s.updateRequired(for: .student, installedVersion: "1.2.0"))
        XCTAssertFalse(s.updateRequired(for: .staff, installedVersion: "0.1"), "empty minimum never blocks")
    }

    func testDefaultsDoNotChangeBehaviour() {
        let s = RemoteSettings(values: RemoteSettings.defaultValues)
        XCTAssertFalse(s.updateRequired(for: .student, installedVersion: "1.0"))
        XCTAssertFalse(s.updateRequired(for: .staff, installedVersion: "1.0"))
        XCTAssertEqual(s.announcement, "")
        s.applyThresholds()
        XCTAssertEqual(TokenRules.defaultExpiryMinutes, 20)
        XCTAssertEqual(TokenRules.staleWindowHours, 4)
    }

    func testUpdateURLMustBeHTTPS() {
        XCTAssertNotNil(RemoteSettings(values: [RemoteSettings.Key.updateURL: "https://apps.apple.com/app/id1"]).safeUpdateURL)
        XCTAssertNil(RemoteSettings(values: [RemoteSettings.Key.updateURL: "http://example.com"]).safeUpdateURL)
        XCTAssertNil(RemoteSettings(values: [RemoteSettings.Key.updateURL: "javascript:alert(1)"]).safeUpdateURL)
        XCTAssertNil(RemoteSettings().safeUpdateURL)
    }

    func testGarbageThresholdsFallBackToDefaults() {
        RemoteSettings(values: [
            RemoteSettings.Key.readyExpiryMinutes: "abc",
            RemoteSettings.Key.staleWindowHours: ""
        ]).applyThresholds()
        XCTAssertEqual(TokenRules.defaultExpiryMinutes, 20)
        XCTAssertEqual(TokenRules.staleWindowHours, 4)
    }
}
