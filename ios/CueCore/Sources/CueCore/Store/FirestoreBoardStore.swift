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
        let previousOrder = localStore.getOrders().first(where: { $0.token == token })

        // 1. Optimistically update local store for instant UI feedback
        let isReplacementOrNew = (fields.createdMs != nil) || (localStore.find(token: token) == nil)
        let localOrder = localStore.writeSync(token: token, fields: fields)
        ordersSubject.send(localStore.getOrders())

        // 2. Build payload updating only relevant fields
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

        // 3. Await Firestore confirmation so rejected writes roll back and surface errors
        do {
            try await docRef.setData(data, merge: true)
            syncLabelSubject.send("Live with the counter.")
            return localOrder
        } catch {
            print("Firestore write error: \(error.localizedDescription)")
            // Roll back only if this optimistic order is still the current version
            let currentOrders = localStore.rollbackWriteSync(
                token: token,
                expectedOrder: localOrder,
                previousOrder: previousOrder
            )
            ordersSubject.send(currentOrders)
            syncLabelSubject.send("Could not sync. Check connection — local copy is safe.")
            throw error
        }
    }

    public func issueNextToken() async throws -> Int {
        try await issueNextTokenWithCursor().token
    }

    /// Atomically reserves and issues the next token via Firestore transaction on `counters/token_counter`
    public func issueNextTokenWithCursor() async throws -> TokenAllocation {
        let counterRef = db.collection("counters").document("token_counter")
        let ordersRef = db.collection("orders")
        let now = Int64(Date().timeIntervalSince1970 * 1000)

        let allocation: TokenAllocation = try await withCheckedThrowingContinuation { continuation in
            db.runTransaction({ (transaction, errorPointer) -> Any? in
                let counterDoc: DocumentSnapshot?
                do {
                    counterDoc = try transaction.getDocument(counterRef)
                } catch {
                    errorPointer?.pointee = error as NSError
                    return nil
                }
                let counterData = counterDoc?.data() ?? [:]
                let storedStart = (counterData["next"] as? NSNumber)?.intValue ?? (counterData["next"] as? Int) ?? 1
                let currentStart = TokenRules.isValidToken(storedStart) ? storedStart : 1
                let currentVersion = (counterData["version"] as? NSNumber)?.int64Value
                    ?? (counterData["version"] as? Int64)
                    ?? 0
                let staleMs = TokenRules.staleWindowMs
                let expiryMs = TokenRules.expiryMs

                var chosenToken: Int? = nil
                for k in 0..<TokenRules.maxToken {
                    let candidate = (currentStart - 1 + k) % TokenRules.maxToken + 1
                    let orderDocRef = ordersRef.document(String(candidate))
                    let orderDoc: DocumentSnapshot?
                    do {
                        orderDoc = try transaction.getDocument(orderDocRef)
                    } catch {
                        errorPointer?.pointee = error as NSError
                        return nil
                    }

                    var isTaken = false
                    if let doc = orderDoc, doc.exists, let data = doc.data() {
                        let t = (data["t"] as? NSNumber)?.int64Value ?? 0
                        let r = (data["r"] as? NSNumber)?.int64Value ?? 0
                        let c = (data["c"] as? NSNumber)?.int64Value ?? 0

                        if (now - t <= staleMs) && (c == 0) {
                            if r == 0 || (now - r <= expiryMs) {
                                isTaken = true
                            }
                        }
                    }

                    if !isTaken {
                        chosenToken = candidate
                        break
                    }
                }

                guard let token = chosenToken else {
                    let err = NSError(domain: "Cue", code: 409, userInfo: [NSLocalizedDescriptionKey: "All \(TokenRules.maxToken) tokens are in use"])
                    errorPointer?.pointee = err
                    return nil
                }

                let nextVal = (token % TokenRules.maxToken) + 1
                let nextVersion = currentVersion + 1
                transaction.setData(
                    ["next": nextVal, "version": nextVersion, "updatedAt": now],
                    forDocument: counterRef,
                    merge: true
                )

                let orderDocRef = ordersRef.document(String(token))
                transaction.setData(["t": now, "r": 0, "c": 0], forDocument: orderDocRef, merge: true)

                return [
                    "token": token,
                    "previousStart": currentStart,
                    "nextStart": nextVal,
                    "counterVersion": nextVersion
                ]
            }) { (object, error) in
                if let error = error {
                    continuation.resume(throwing: error)
                } else if let result = object as? [String: Any],
                          let token = result["token"] as? Int,
                          let previousStart = result["previousStart"] as? Int,
                          let nextStart = result["nextStart"] as? Int,
                          let counterVersion = result["counterVersion"] as? Int64 {
                    continuation.resume(returning: TokenAllocation(
                        token: token,
                        previousStart: previousStart,
                        nextStart: nextStart,
                        counterVersion: counterVersion
                    ))
                } else {
                    continuation.resume(throwing: NSError(domain: "Cue", code: 500, userInfo: [NSLocalizedDescriptionKey: "Transaction failed"]))
                }
            }
        }

        // Update local state with the issued token
        _ = localStore.writeSync(token: allocation.token, fields: OrderWriteFields(createdMs: now, readyMs: 0, collectedMs: 0))
        try await localStore.setNextStart(allocation.nextStart)
        ordersSubject.send(localStore.getOrders())
        syncLabelSubject.send("Live with the counter.")

        return allocation
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
    public func getNextStart() async throws -> Int {
        let counter = try await db.collection("counters").document("token_counter").getDocument(source: .server)
        let storedStart = (counter.data()?["next"] as? NSNumber)?.intValue
            ?? (counter.data()?["next"] as? Int)
            ?? 1
        let start = TokenRules.isValidToken(storedStart) ? storedStart : 1
        try await localStore.setNextStart(start)
        return start
    }

    public func setNextStart(_ token: Int) async throws {
        let safeToken = TokenRules.isValidToken(token) ? token : 1
        let counterRef = db.collection("counters").document("token_counter")
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            db.runTransaction({ transaction, errorPointer -> Any? in
                let counterDoc: DocumentSnapshot?
                do {
                    counterDoc = try transaction.getDocument(counterRef)
                } catch {
                    errorPointer?.pointee = error as NSError
                    return nil
                }
                let data = counterDoc?.data() ?? [:]
                let version = (data["version"] as? NSNumber)?.int64Value
                    ?? (data["version"] as? Int64)
                    ?? 0
                let nextVersion = version + 1
                transaction.setData(
                    ["next": safeToken, "version": nextVersion, "updatedAt": now],
                    forDocument: counterRef,
                    merge: true
                )
                return nextVersion
            }) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
        try await localStore.setNextStart(safeToken)
    }

    public func restoreNextStart(from allocation: TokenAllocation) async throws -> Bool {
        let counterRef = db.collection("counters").document("token_counter")
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        let restored: Bool = try await withCheckedThrowingContinuation { continuation in
            db.runTransaction({ transaction, errorPointer -> Any? in
                let counterDoc: DocumentSnapshot?
                do {
                    counterDoc = try transaction.getDocument(counterRef)
                } catch {
                    errorPointer?.pointee = error as NSError
                    return nil
                }
                let data = counterDoc?.data() ?? [:]
                let version = (data["version"] as? NSNumber)?.int64Value
                    ?? (data["version"] as? Int64)
                    ?? 0
                guard version == allocation.counterVersion else { return false }
                transaction.setData(
                    [
                        "next": allocation.previousStart,
                        "version": version + 1,
                        "updatedAt": now
                    ],
                    forDocument: counterRef,
                    merge: true
                )
                return true
            }) { object, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let restored = object as? Bool {
                    continuation.resume(returning: restored)
                } else {
                    continuation.resume(throwing: NSError(
                        domain: "Cue",
                        code: 500,
                        userInfo: [NSLocalizedDescriptionKey: "Counter update failed"]
                    ))
                }
            }
        }
        if restored {
            try await localStore.setNextStart(allocation.previousStart)
        }
        return restored
    }
}
