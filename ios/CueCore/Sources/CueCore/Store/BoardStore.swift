import Foundation
import Combine

/// Common interface for order board data access, decoupling SwiftUI views from Firebase.
public protocol BoardStore: AnyObject {
    /// Publisher broadcasting live order updates
    var ordersPublisher: AnyPublisher<[Order], Never> { get }

    /// Publisher broadcasting sync status label ("Live with the counter", "Local only...", etc.)
    var syncLabelPublisher: AnyPublisher<String, Never> { get }

    /// Indicates whether cloud Firestore synchronization is active
    var isFirebase: Bool { get }

    /// Current snapshot of all non-stale orders
    func getOrders() -> [Order]

    /// Current sync label text
    func getSyncLabel() -> String

    /// Writes fields for an order (created, ready, collected). Returns the updated order.
    @discardableResult
    func write(token: Int, fields: OrderWriteFields) async throws -> Order

    /// Finds an active order for a given token number
    func find(token: Int) -> Order?

    /// Generates the live Preparing and Ready queues
    func view(expiryMinutes: Int) -> OrderView

    // MARK: - Student multi-order tracking
    func getTrackedTokens() async -> [Int]
    func addTrackedToken(_ token: Int) async -> [Int]
    func removeTrackedToken(_ token: Int) async -> [Int]

    // MARK: - Staff next token recommendation & reservation
    func getNextStart() async -> Int
    func setNextStart(_ token: Int) async

    /// Atomically reserves and creates the next available order token (1–150).
    /// Prevents two staff devices from issuing the same token via Firestore atomic transactions.
    func issueNextToken() async throws -> Int
}

public extension BoardStore {
    func view() -> OrderView {
        return view(expiryMinutes: TokenRules.defaultExpiryMinutes)
    }
}
