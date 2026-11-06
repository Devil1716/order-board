import SwiftUI
import Combine
import CueCore

public enum StudentViewMode: String, CaseIterable {
    case myOrders = "My Orders"
    case board = "Board View"
}

@MainActor
public class CueStudentViewModel: ObservableObject {
    public let store: BoardStore

    @Published public var orders: [Order] = []
    @Published public var trackedTokens: [Int] = []
    @Published public var syncLabel: String = ""
    @Published public var tokenInput: String = ""
    @Published public var viewMode: StudentViewMode = .myOrders

    // Ready alert state
    @Published public var alertToken: Int? = nil
    private var ackedReadyTokens: [Int: Int64] = [:] // token -> readyMs
    private var alertRepeatTimer: Task<Void, Never>?
    private var lastReadySignature: String?

    private var cancellables = Set<AnyCancellable>()

    public init(store: BoardStore = StoreFactory.createStore()) {
        self.store = store
        self.syncLabel = store.getSyncLabel()
        self.orders = store.getOrders()

        store.ordersPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newOrders in
                self?.handleOrdersUpdate(newOrders)
            }
            .store(in: &cancellables)

        store.syncLabelPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newLabel in
                self?.syncLabel = newLabel
            }
            .store(in: &cancellables)

        Task {
            self.trackedTokens = await store.getTrackedTokens()
            self.checkForReadyAlerts()
        }
    }

    public var orderView: OrderView {
        TokenRules.computeView(orders: orders)
    }

    public var latestReadyOrder: Order? {
        orderView.ready.first
    }

    public func tokenState(for token: Int) -> StudentTokenState {
        let order = orders.first(where: { $0.token == token })
        return StudentTokenState.derive(
            token: token,
            order: order,
            prepQueue: orderView.preparing
        )
    }

    public func isTracked(_ token: Int) -> Bool {
        trackedTokens.contains(token)
    }

    // MARK: - Actions
    public func trackInputToken() {
        guard let token = Int(tokenInput), TokenRules.isValidToken(token) else { return }
        tokenInput = ""

        Task {
            // Request notification permissions when user starts tracking
            _ = await NotificationService.requestPermission()

            // Turn on sound by default when tracking starts
            if !SoundService.shared.isSoundEnabled {
                SoundService.shared.isSoundEnabled = true
            }

            // Keep screen awake while tracking orders
            KeepAwakeService.setKeepAwake(true)

            trackedTokens = await store.addTrackedToken(token)
            HapticsService.impact()
            checkForReadyAlerts()
        }
    }

    public func removeTrackedToken(_ token: Int) {
        if alertToken == token {
            dismissAlert()
        }
        ackedReadyTokens.removeValue(forKey: token)
        NotificationService.cancelNotification(token: token)

        Task {
            trackedTokens = await store.removeTrackedToken(token)
            if trackedTokens.isEmpty {
                KeepAwakeService.setKeepAwake(false)
            }
        }
    }

    public func markCollected(_ token: Int) {
        if alertToken == token {
            dismissAlert()
        }
        HapticsService.impact()
        NotificationService.cancelNotification(token: token)

        Task {
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            _ = try? await store.write(token: token, fields: OrderWriteFields(collectedMs: now))
        }
    }

    // MARK: - Alerts Management
    private func handleOrdersUpdate(_ newOrders: [Order]) {
        self.orders = newOrders
        let view = TokenRules.computeView(orders: newOrders)

        // Soft chime when a new public order is ready (if not tracked)
        if let topReady = view.ready.first {
            let sig = "\(topReady.token)|\(topReady.readyMs)"
            if lastReadySignature != nil && lastReadySignature != sig && !isTracked(topReady.token) {
                SoundService.shared.chime()
            }
            lastReadySignature = sig
        }

        checkForReadyAlerts()
    }

    public func checkForReadyAlerts() {
        let now = Int64(Date().timeIntervalSince1970 * 1000)
        var pendingAlertToken: Int? = nil

        for token in trackedTokens {
            guard let order = orders.first(where: { $0.token == token }),
                  order.readyMs > 0,
                  order.collectedMs == 0,
                  (now - order.readyMs) <= TokenRules.expiryMs else {
                continue
            }

            // Check if this ready event has already been acknowledged
            if let ackedMs = ackedReadyTokens[token], ackedMs == order.readyMs {
                continue
            }

            pendingAlertToken = token
            break
        }

        if let pending = pendingAlertToken {
            if alertToken != pending {
                startAlert(for: pending)
            }
        } else if alertToken != nil {
            dismissAlert()
        }
    }

    private func startAlert(for token: Int) {
        alertToken = token
        KeepAwakeService.setKeepAwake(true)
        HapticsService.buzz()
        SoundService.shared.chime()
        NotificationService.scheduleReadyNotification(token: token)

        // Repeat buzz/chime every 5s up to 5 times
        alertRepeatTimer?.cancel()
        alertRepeatTimer = Task {
            for _ in 0..<5 {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                if Task.isCancelled || alertToken == nil { break }
                HapticsService.buzz()
                SoundService.shared.chime()
            }
        }
    }

    public func dismissAlert() {
        alertRepeatTimer?.cancel()
        if let token = alertToken {
            let order = orders.first(where: { $0.token == token })
            ackedReadyTokens[token] = order?.readyMs ?? Int64(Date().timeIntervalSince1970 * 1000)
        }
        alertToken = nil
        if trackedTokens.isEmpty {
            KeepAwakeService.setKeepAwake(false)
        }
    }
}
