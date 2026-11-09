import Foundation
import Combine
import FirebaseFirestore

/// Production Firestore store for multi-device realtime synchronization.
/// Subscribes to snapshot listener on collection `orders`, maintains local offline cache,
/// and mirrors local-first behavior.
public class FirestoreBoardStore: BoardStore {
    private let db: Firestore
    private let localStore: LocalBoardStore
    private var listenerRegistration: ListenerRegistration?

    private let ordersSubject = CurrentValueSubject<[Order], Never>([])
    private let syncLabelSubject = CurrentValueSubject<String, Never>("Connecting to counter...")

    public var ordersPublisher: AnyPublisher<[Order], Never> {
        ordersSubject.eraseToAnyPublisher()
    }

    public var syncLabelPublisher: AnyPublisher<String, Never> {
        syncLabelSubject.eraseToAnyPublisher()
    }

    public var isFirebase: Bool { true }

    public init(firestore: Firestore = Firestore.firestore(), localStore: LocalBoardStore = LocalBoardStore()) {
        self.db = firestore
        self.localStore = localStore

        // Start with local store data
        self.ordersSubject.send(localStore.getOrders())

        startListening()
    }

    deinit {
        listenerRegistration?.remove()
    }

    private func startListening() {
        let collectionRef = db.collection("orders")

        listenerRegistration = collectionRef.addSnapshotListener(includeMetadataChanges: true) { [weak self] snapshot, error in
            guard let self = self else { return }

            if let error = error {
                print("Firestore snapshot listener error: \(error.localizedDescription)")
                self.syncLabelSubject.send("Firestore error — using local copy.")
                return
            }

            guard let snapshot = snapshot else { return }

            var fetchedOrders: [Order] = []
            for doc in snapshot.documents {
                guard let token = Int(doc.documentID), TokenRules.isValidToken(token) else { continue }
                let data = doc.data()
                let t = (data["t"] as? NSNumber)?.int64Value ?? (data["t"] as? Int64) ?? 0
                let r = (data["r"] as? NSNumber)?.int64Value ?? (data["r"] as? Int64) ?? 0
                let c = (data["c"] as? NSNumber)?.int64Value ?? (data["c"] as? Int64) ?? 0

                let order = Order(token: token, createdMs: t, readyMs: r, collectedMs: c)
                fetchedOrders.append(order)
            }

            // Prune stale orders older than 4 hours
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            let validOrders = fetchedOrders.filter { (now - $0.createdMs) <= TokenRules.staleWindowMs }

            // Atomically replace local cache with authoritative remote snapshot
            self.localStore.replaceOrdersSync(validOrders)
            self.ordersSubject.send(validOrders)

            // Derive connection status from snapshot metadata
            if snapshot.metadata.isFromCache {
                if snapshot.metadata.hasPendingWrites {
                    self.syncLabelSubject.send("Offline — changes saved locally.")
                } else {
                    self.syncLabelSubject.send("Offline (cached) — reconnecting...")
                }
            } else {
                self.syncLabelSubject.send("Live with the counter.")
            }
        }
    }

    public func getOrders() -> [Order] {
        return ordersSubject.value
    }

    public func getSyncLabel() -> String {
        return syncLabelSubject.value
    }

    @discardableResult
    public func write(token: Int, fields: OrderWriteFields) async throws -> Order {
        // 1. Optimistically update local store immediately for instant UI progress
        let isReplacementOrNew = (fields.createdMs != nil) || (localStore.find(token: token) == nil)
        let localOrder = localStore.writeSync(token: token, fields: fields)
        ordersSubject.send(localStore.getOrders())

        // 2. Build payload
        let docRef = db.collection("orders").document(String(token))
        var data: [String: Any] = [:]

        if let t = fields.createdMs {
            // New order or token replacement: reset ready and collected timestamps
            data["t"] = t
            data["r"] = fields.readyMs ?? Int64(0)
            data["c"] = fields.collectedMs ?? Int64(0)
        } else if isReplacementOrNew {
            data["t"] = localOrder.createdMs
            data["r"] = localOrder.readyMs
            data["c"] = localOrder.collectedMs
        } else {
            // Partial status update for existing active order
            if let r = fields.readyMs { data["r"] = r }
            if let c = fields.collectedMs { data["c"] = c }
        }

        // 3. Dispatch to Firestore in background without blocking local UI execution
        Task { [weak self] in
            do {
                try await docRef.setData(data, merge: true)
                self?.syncLabelSubject.send("Live with the counter.")
            } catch {
                print("Firestore write error: \(error.localizedDescription)")
                self?.syncLabelSubject.send("Could not sync. Check connection — local copy is safe.")
            }
        }

        return localOrder
    }

    public func find(token: Int) -> Order? {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        return ordersSubject.value.first { $0.token == token && (now - $0.createdMs) <= TokenRules.staleWindowMs }
    }

    public func view(expiryMinutes: Int = TokenRules.defaultExpiryMinutes) -> OrderView {
        return TokenRules.computeView(orders: ordersSubject.value, expiryMinutes: expiryMinutes)
    }

    // MARK: - Student Multi-Tracking (delegated to local store)
    public func getTrackedTokens() async -> [Int] {
        await localStore.getTrackedTokens()
    }

    public func addTrackedToken(_ token: Int) async -> [Int] {
        await localStore.addTrackedToken(token)
    }

    public func removeTrackedToken(_ token: Int) async -> [Int] {
        await localStore.removeTrackedToken(token)
    }

    // MARK: - Staff Next Token (delegated to local store)
    public func getNextStart() async -> Int {
        await localStore.getNextStart()
    }

    public func setNextStart(_ token: Int) async {
        await localStore.setNextStart(token)
    }
}
