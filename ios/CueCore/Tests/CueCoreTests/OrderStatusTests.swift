import XCTest
@testable import CueCore

final class OrderStatusTests: XCTestCase {

    func testWaitingStatusWhenOrderNotFound() {
        let now: Int64 = 1_000_000_000
        let status = StudentTokenState.derive(
            token: 42,
            order: nil,
            prepQueue: [],
            nowMs: now
        )

        XCTAssertEqual(status.kind, .waiting)
        XCTAssertEqual(status.title, "Waiting")
        XCTAssertEqual(status.subtitle, "Staff haven’t added this token yet.")
        XCTAssertFalse(status.isReady)
        XCTAssertFalse(status.showCollect)
    }

    func testWaitingStatusWhenOrderIsStale() {
        let now: Int64 = 1_000_000_000
        let staleOrder = Order(token: 42, createdMs: now - (5 * 3600 * 1000), readyMs: 0)

        let status = StudentTokenState.derive(
            token: 42,
            order: staleOrder,
            prepQueue: [],
            nowMs: now
        )

        XCTAssertEqual(status.kind, .waiting)
    }

    func testYouAreNextWhenFirstInQueue() {
        let now: Int64 = 1_000_000_000
        let o1 = Order(token: 10, createdMs: now - 120_000, readyMs: 0)
        let o2 = Order(token: 11, createdMs: now - 60_000, readyMs: 0)

        let status = StudentTokenState.derive(
            token: 10,
            order: o1,
            prepQueue: [o1, o2],
            nowMs: now
        )

        XCTAssertEqual(status.kind, .youAreNext)
        XCTAssertEqual(status.title, "You’re next")
        XCTAssertEqual(status.subtitle, "Almost there — hang tight.")
        XCTAssertEqual(status.ageText, "2 min in queue")
        XCTAssertFalse(status.isReady)
    }

    func testPreparingWithOrdersAhead() {
        let now: Int64 = 1_000_000_000
        let o1 = Order(token: 10, createdMs: now - 180_000)
        let o2 = Order(token: 11, createdMs: now - 120_000)
        let o3 = Order(token: 12, createdMs: now - 60_000)

        // Token 11 is at index 1 -> 1 order ahead
        let status11 = StudentTokenState.derive(
            token: 11,
            order: o2,
            prepQueue: [o1, o2, o3],
            nowMs: now
        )
        XCTAssertEqual(status11.kind, .preparing)
        XCTAssertEqual(status11.title, "Preparing")
        XCTAssertEqual(status11.subtitle, "1 order ahead.")

        // Token 12 is at index 2 -> 2 orders ahead
        let status12 = StudentTokenState.derive(
            token: 12,
            order: o3,
            prepQueue: [o1, o2, o3],
            nowMs: now
        )
        XCTAssertEqual(status12.kind, .preparing)
        XCTAssertEqual(status12.title, "Preparing")
        XCTAssertEqual(status12.subtitle, "2 orders ahead.")
    }

    func testReadyStatus() {
        let now: Int64 = 1_000_000_000
        let o = Order(token: 25, createdMs: now - 600_000, readyMs: now - 120_000)

        let status = StudentTokenState.derive(
            token: 25,
            order: o,
            prepQueue: [],
            nowMs: now
        )

        XCTAssertEqual(status.kind, .ready)
        XCTAssertEqual(status.title, "Ready")
        XCTAssertEqual(status.subtitle, "Collect it at the counter.")
        XCTAssertEqual(status.ageText, "Ready 2 min")
        XCTAssertTrue(status.isReady)
        XCTAssertTrue(status.showCollect)
    }

    func testTimedOutStatus() {
        let now: Int64 = 1_000_000_000
        // Ready 22 minutes ago -> expired (20 min expiry)
        let o = Order(token: 30, createdMs: now - 2_000_000, readyMs: now - (22 * 60 * 1000))

        let status = StudentTokenState.derive(
            token: 30,
            order: o,
            prepQueue: [],
            nowMs: now
        )

        XCTAssertEqual(status.kind, .timedOut)
        XCTAssertEqual(status.title, "Timed out")
        XCTAssertEqual(status.subtitle, "Ask at the counter.")
        XCTAssertFalse(status.isReady)
        XCTAssertFalse(status.showCollect)
    }

    func testCollectedStatus() {
        let now: Int64 = 1_000_000_000
        let o = Order(token: 35, createdMs: now - 500_000, readyMs: now - 100_000, collectedMs: now - 10_000)

        let status = StudentTokenState.derive(
            token: 35,
            order: o,
            prepQueue: [],
            nowMs: now
        )

        XCTAssertEqual(status.kind, .collected)
        XCTAssertEqual(status.title, "Collected")
        XCTAssertEqual(status.subtitle, "Enjoy your food.")
        XCTAssertFalse(status.isReady)
        XCTAssertFalse(status.showCollect)
    }

    func testStaffTokenModeDerivation() {
        let prep = [Order(token: 5, createdMs: 1000)]
        let ready = [Order(token: 15, createdMs: 500, readyMs: 800)]
        let view = OrderView(preparing: prep, ready: ready)

        XCTAssertEqual(StaffTokenMode.modeOf(token: 5, in: view), .preparing)
        XCTAssertEqual(StaffTokenMode.modeOf(token: 15, in: view), .ready)
        XCTAssertEqual(StaffTokenMode.modeOf(token: 99, in: view), .none)

        // Button titles
        XCTAssertEqual(StaffTokenMode.preparing.mainButtonTitle(for: 5), "Ready: 5")
        XCTAssertEqual(StaffTokenMode.ready.mainButtonTitle(for: 15), "Hand over: 15")
        XCTAssertEqual(StaffTokenMode.none.mainButtonTitle(for: 99), "Add token 99")
        XCTAssertEqual(StaffTokenMode.none.mainButtonTitle(for: nil), "Add token")
    }
}
