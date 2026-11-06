import Foundation
import Combine

/// Local-first, thread-safe in-memory board store with UserDefaults persistence.
/// Used when Firebase is not configured or offline, matching `shared/js/store.js`.
public class LocalBoardStore: BoardStore {
    private let ordersKey = "ob-orders-v1"
    private let nextKey = "ob-next"
    private let minesKey = "ob-mines-v1"
    private let legacyMineKey = "ob-mine"

    private let queue = DispatchQueue(label: "in.sharan.orderboard.localstore")
    private var orders: [Order] = []
    private let ordersSubject = CurrentValueSubject<[Order], Never>([])
    private let syncLabelSubject = CurrentValueSubject<String, Never>("On this phone only — connect Firebase to sync with the counter.")

    private let userDefaults: UserDefaults

    public var ordersPublisher: AnyPublisher<[Order], Never> {
        ordersSubject.eraseToAnyPublisher()
    }

    public var syncLabelPublisher: AnyPublisher<String, Never> {
        syncLabelSubject.eraseToAnyPublisher()
    }

    public var isFirebase: Bool { false }

    public init(userDefaults: UserDefaults = .standard) {
        self.userDefaults = userDefaults
        queue.sync {
            loadLocalInternal()
            pruneStaleInternal()
            emitInternal()
        }
    }

    private func emitInternal() {
        ordersSubject.send(orders)
    }

    private func persistLocalInternal() {
        if let data = try? JSONEncoder().encode(orders) {
            userDefaults.set(data, forKey: ordersKey)
        }
    }

    private func loadLocalInternal() {
        if let data = userDefaults.data(forKey: ordersKey),
           let decoded = try? JSONDecoder().decode([Order].self, forKey: data) {
            self.orders = decoded.filter { $0.token > 0 }
        } else if let str = userDefaults.string(forKey: ordersKey),
                  let data = str.data(using: .utf8),
                  let decoded = try? JSONDecoder().decode([Order].self, from: data) {
            self.orders = decoded.filter { $0.token > 0 }
        }
    }

    private func pruneStaleInternal() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        orders = orders.filter { (now - $0.createdMs) <= TokenRules.staleWindowMs }
    }

    public func pruneStale() {
        queue.sync {
            pruneStaleInternal()
            persistLocalInternal()
            emitInternal()
        }
    }

    public func getOrders() -> [Order] {
        queue.sync { orders }
    }

    public func getSyncLabel() -> String {
        syncLabelSubject.value
    }

    public func setSyncLabel(_ label: String) {
        syncLabelSubject.send(label)
    }

    /// Atomically replaces cached orders with an authoritative snapshot from Firestore
    public func replaceOrdersSync(_ newOrders: [Order]) {
        queue.sync {
            self.orders = newOrders.filter { $0.token > 0 }
            self.pruneStaleInternal()
            self.persistLocalInternal()
            self.emitInternal()
        }
    }

    @discardableResult
    public func writeSync(token: Int, fields: OrderWriteFields) -> Order {
        queue.sync {
            var existing = orders.first(where: { $0.token == token })
            let now = Int64(Date().timeIntervalSince1970 * 1000)

            if existing == nil {
                let newOrder = Order(
                    token: token,
                    createdMs: fields.createdMs ?? now,
                    readyMs: fields.readyMs ?? 0,
                    collectedMs: fields.collectedMs ?? 0
                )
                orders.append(newOrder)
                existing = newOrder
            } else if let index = orders.firstIndex(where: { $0.token == token }) {
                if let c = fields.createdMs { orders[index].createdMs = c }
                if let r = fields.readyMs { orders[index].readyMs = r }
                if let col = fields.collectedMs { orders[index].collectedMs = col }
                existing = orders[index]
            }

            pruneStaleInternal()
            persistLocalInternal()
            emitInternal()
            return existing!
        }
    }

    @discardableResult
    public func write(token: Int, fields: OrderWriteFields) async throws -> Order {
        return writeSync(token: token, fields: fields)
    }

    public func find(token: Int) -> Order? {
        queue.sync {
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            return orders.first { $0.token == token && (now - $0.createdMs) <= TokenRules.staleWindowMs }
        }
    }

    public func view(expiryMinutes: Int = TokenRules.defaultExpiryMinutes) -> OrderView {
        let currentOrders = getOrders()
        return TokenRules.computeView(orders: currentOrders, expiryMinutes: expiryMinutes)
    }

    // MARK: - Student Tracked Tokens
    public func getTrackedTokens() async -> [Int] {
        if let raw = userDefaults.string(forKey: minesKey),
           let data = raw.data(using: .utf8),
           let arr = try? JSONDecoder().decode([Int].self, from: data) {
            return arr.filter { TokenRules.isValidToken($0) }
        }
        if let arr = userDefaults.array(forKey: minesKey) as? [Int] {
            return arr.filter { TokenRules.isValidToken($0) }
        }
        // Legacy single token migration
        let legacy = userDefaults.integer(forKey: legacyMineKey)
        if legacy > 0 {
            let list = [legacy]
            _ = await setTrackedTokens(list)
            return list
        }
        return []
    }

    private func setTrackedTokens(_ tokens: [Int]) async -> [Int] {
        var unique: [Int] = []
        for t in tokens where TokenRules.isValidToken(t) && !unique.contains(t) {
            unique.append(t)
        }
        if unique.isEmpty {
            userDefaults.removeObject(forKey: minesKey)
            userDefaults.removeObject(forKey: legacyMineKey)
            return []
        }
        if let data = try? JSONEncoder().encode(unique),
           let str = String(data: data, encoding: .utf8) {
            userDefaults.set(str, forKey: minesKey)
        }
        userDefaults.set(unique.first ?? 0, forKey: legacyMineKey)
        return unique
    }

    public func addTrackedToken(_ token: Int) async -> [Int] {
        guard TokenRules.isValidToken(token) else { return await getTrackedTokens() }
        var list = await getTrackedTokens()
        if !list.contains(token) {
            list.append(token)
        }
        return await setTrackedTokens(list)
    }

    public func removeTrackedToken(_ token: Int) async -> [Int] {
        var list = await getTrackedTokens()
        list.removeAll(where: { $0 == token })
        return await setTrackedTokens(list)
    }

    // MARK: - Staff Next Token
    public func getNextStart() async -> Int {
        let val = userDefaults.integer(forKey: nextKey)
        return TokenRules.isValidToken(val) ? val : 1
    }

    public func setNextStart(_ token: Int) async {
        let safeVal = token > TokenRules.maxToken ? 1 : token
        userDefaults.set(safeVal, forKey: nextKey)
    }
}

private extension JSONDecoder {
    func decode<T: Decodable>(_ type: T.Type, forKey key: Data) throws -> T {
        return try self.decode(type, from: key)
    }
}
