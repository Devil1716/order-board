import XCTest
@testable import CueCore

final class LocalBoardStoreTests: XCTestCase {
    var userDefaults: UserDefaults!
    var suiteName: String!

    override func setUp() {
        super.setUp()
        suiteName = "test-ob-\(UUID().uuidString)"
        userDefaults = UserDefaults(suiteName: suiteName)!
    }

    override func tearDown() {
        userDefaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    func testWriteAndFindOrder() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)
        XCTAssertEqual(store.getSyncLabel(), "On this phone only — connect Firebase to sync with the counter.")

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let order = try await store.write(token: 42, fields: OrderWriteFields(createdMs: now, readyMs: 0, collectedMs: 0))

        XCTAssertEqual(order.token, 42)
        XCTAssertEqual(order.createdMs, now)
        XCTAssertEqual(order.readyMs, 0)
        XCTAssertEqual(order.collectedMs, 0)

        let found = store.find(token: 42)
        XCTAssertNotNil(found)
        XCTAssertEqual(found?.token, 42)

        // Mark ready
        let readyTime = now + 5000
        let readyOrder = try await store.write(token: 42, fields: OrderWriteFields(readyMs: readyTime))
        XCTAssertEqual(readyOrder.readyMs, readyTime)
        XCTAssertEqual(store.find(token: 42)?.readyMs, readyTime)

        // Mark collected
        let collectedTime = now + 10000
        let collectedOrder = try await store.write(token: 42, fields: OrderWriteFields(collectedMs: collectedTime))
        XCTAssertEqual(collectedOrder.collectedMs, collectedTime)
        XCTAssertEqual(store.find(token: 42)?.collectedMs, collectedTime)
    }

    func testTrackedTokensPersistence() async {
        let store = LocalBoardStore(userDefaults: userDefaults)

        let initial = await store.getTrackedTokens()
        XCTAssertEqual(initial, [])

        let added = await store.addTrackedToken(7)
        XCTAssertEqual(added, [7])

        let added2 = await store.addTrackedToken(21)
        XCTAssertEqual(added2, [7, 21])

        // Duplicate add is a no-op
        let dup = await store.addTrackedToken(7)
        XCTAssertEqual(dup, [7, 21])

        // Out of range token rejected
        let invalid = await store.addTrackedToken(200)
        XCTAssertEqual(invalid, [7, 21])

        // Remove token
        let removed = await store.removeTrackedToken(7)
        XCTAssertEqual(removed, [21])

        // Re-instantiate store to test persistence
        let store2 = LocalBoardStore(userDefaults: userDefaults)
        let persisted = await store2.getTrackedTokens()
        XCTAssertEqual(persisted, [21])
    }

    func testNextStartPointer() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)

        let initial = try await store.getNextStart()
        XCTAssertEqual(initial, 1)

        try await store.setNextStart(50)
        let updated = try await store.getNextStart()
        XCTAssertEqual(updated, 50)

        // Wrap around when setting > 200
        try await store.setNextStart(201)
        let wrapped = try await store.getNextStart()
        XCTAssertEqual(wrapped, 1)
    }

    func testUndoOnlyRestoresUnchangedCursor() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)
        try await store.setNextStart(10)

        let allocation = try await store.issueNextTokenWithCursor()
        XCTAssertEqual(allocation.token, 10)
        XCTAssertEqual(allocation.previousStart, 10)
        let nextStart = try await store.getNextStart()
        XCTAssertEqual(nextStart, 11)

        let restored = try await store.restoreNextStart(from: allocation)
        XCTAssertTrue(restored)
        let restoredStart = try await store.getNextStart()
        XCTAssertEqual(restoredStart, 10)
        let restoredAgain = try await store.restoreNextStart(from: allocation)
        XCTAssertFalse(restoredAgain)
    }

    func testUndoDoesNotOverwriteNewCursor() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)
        try await store.setNextStart(10)
        let allocation = try await store.issueNextTokenWithCursor()
        try await store.setNextStart(12)

        let restored = try await store.restoreNextStart(from: allocation)
        XCTAssertFalse(restored)
        let nextStart = try await store.getNextStart()
        XCTAssertEqual(nextStart, 12)
    }

    func testPruneStaleOrders() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        // Create an order older than 4 hours
        let staleCreated = now - (5 * 3600 * 1000)
        try await store.write(token: 99, fields: OrderWriteFields(createdMs: staleCreated, readyMs: 0, collectedMs: 0))

        store.pruneStale()
        XCTAssertNil(store.find(token: 99))
        XCTAssertFalse(store.getOrders().contains(where: { $0.token == 99 }))
    }

    func testTokenReplacementAndReuse() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        // 1. Initial order for token 5
        let o1 = try await store.write(token: 5, fields: OrderWriteFields(createdMs: now, readyMs: 0, collectedMs: 0))
        XCTAssertEqual(o1.token, 5)
        XCTAssertEqual(store.view().preparing.map(\.token), [5])

        // 2. Mark ready and collected
        _ = try await store.write(token: 5, fields: OrderWriteFields(readyMs: now + 5000))
        _ = try await store.write(token: 5, fields: OrderWriteFields(collectedMs: now + 10000))
        XCTAssertFalse(store.view().preparing.contains(where: { $0.token == 5 }))
        XCTAssertFalse(store.view().ready.contains(where: { $0.token == 5 }))

        // 3. Replace token 5 with a new order
        let newTime = now + 60000
        let o2 = try await store.write(token: 5, fields: OrderWriteFields(createdMs: newTime))
        XCTAssertEqual(o2.createdMs, newTime)
        XCTAssertEqual(o2.readyMs, 0, "Replacement must reset readyMs to 0")
        XCTAssertEqual(o2.collectedMs, 0, "Replacement must reset collectedMs to 0")

        // 4. Token 5 is back in preparing queue
        let view = store.view()
        XCTAssertTrue(view.preparing.contains(where: { $0.token == 5 }))
        XCTAssertFalse(view.ready.contains(where: { $0.token == 5 }))
    }

    func testRollbackPreservesUpdatesToOtherTokens() {
        let store = LocalBoardStore(userDefaults: userDefaults)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let original = Order(token: 1, createdMs: now)
        let optimistic = Order(token: 1, createdMs: now, readyMs: now + 1_000)
        let updatedOther = Order(token: 2, createdMs: now, collectedMs: now + 2_000)

        store.replaceOrdersSync([optimistic, updatedOther])
        let result = store.rollbackWriteSync(token: 1, expectedOrder: optimistic, previousOrder: original)

        XCTAssertEqual(result, [original, updatedOther])
        XCTAssertEqual(store.getOrders(), [original, updatedOther])
    }

    func testRollbackDoesNotReplaceNewerVersionOfSameToken() {
        let store = LocalBoardStore(userDefaults: userDefaults)
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let original = Order(token: 1, createdMs: now)
        let optimistic = Order(token: 1, createdMs: now, readyMs: now + 1_000)
        let newer = Order(token: 1, createdMs: now, readyMs: now + 2_000)

        store.replaceOrdersSync([newer])
        let result = store.rollbackWriteSync(token: 1, expectedOrder: optimistic, previousOrder: original)

        XCTAssertEqual(result, [newer])
        XCTAssertEqual(store.getOrders(), [newer])
    }

    func testKeychainServicePinFlow() {
        KeychainService.deletePin()
        XCTAssertFalse(KeychainService.hasPin())
        XCTAssertFalse(KeychainService.verifyPin("1234"), "Must not unlock when no PIN is set")

        XCTAssertTrue(KeychainService.savePin("1234"))
        XCTAssertTrue(KeychainService.hasPin())
        XCTAssertEqual(KeychainService.getPin(), "1234")
        XCTAssertTrue(KeychainService.verifyPin("1234"))
        XCTAssertFalse(KeychainService.verifyPin("9999"))

        // Update PIN
        XCTAssertTrue(KeychainService.savePin("5678"))
        XCTAssertEqual(KeychainService.getPin(), "5678")
        XCTAssertTrue(KeychainService.verifyPin("5678"))

        // Cleanup
        KeychainService.deletePin()
        XCTAssertFalse(KeychainService.hasPin())
        XCTAssertNil(KeychainService.getPin())
        XCTAssertFalse(KeychainService.verifyPin("5678"), "Must not unlock after deletion")
    }

    func testIssueNextTokenAtomic() async throws {
        let store = LocalBoardStore(userDefaults: userDefaults)
        try await store.setNextStart(10)
        let t1 = try await store.issueNextToken()
        XCTAssertEqual(t1, 10)
        XCTAssertTrue(store.view().preparing.contains(where: { $0.token == 10 }))

        let t2 = try await store.issueNextToken()
        XCTAssertEqual(t2, 11)
        XCTAssertTrue(store.view().preparing.contains(where: { $0.token == 11 }))
    }
}
