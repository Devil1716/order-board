import SwiftUI
import Combine
import CueCore

@MainActor
public class CueStaffViewModel: ObservableObject {
    public let store: BoardStore

    @Published public var orders: [Order] = []
    @Published public var syncLabel: String = ""
    @Published public var typed: String = ""
    @Published public var showAllPrep: Bool = false
    @Published public var showAllReady: Bool = false
    @Published public var nextStart: Int = 1

    // Toast state
    @Published public var toastMessage: String?
    @Published public var showUndo: Bool = false
    private var undoAction: (() -> Void)?
    private var toastTask: Task<Void, Never>?

    // Confirmation dialog for Clear All
    @Published public var showClearAllConfirm: Bool = false

    // PIN Gate state
    @Published public var isUnlocked: Bool = false
    @Published public var showPinSettings: Bool = false
    @Published public var staffEmail: String?
    @Published public var signInError: String?
    @Published public var isSigningIn: Bool = false

    private var cancellables = Set<AnyCancellable>()

    public init(store: BoardStore = StoreFactory.createStore()) {
        self.store = store
        self.syncLabel = store.getSyncLabel()
        self.orders = store.getOrders()

        // Check if PIN gate is active or onboarding needs to be shown
        if !KeychainService.hasCompletedOnboarding {
            self.isUnlocked = false
        } else if KeychainService.isPinEnabled {
            // Stay locked whenever PIN protection is enabled (never unlock on read failure)
            self.isUnlocked = false
        } else {
            self.isUnlocked = true
        }

        store.ordersPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newOrders in
                self?.orders = newOrders
            }
            .store(in: &cancellables)

        store.syncLabelPublisher
            .receive(on: DispatchQueue.main)
            .sink { [weak self] newLabel in
                self?.syncLabel = newLabel
            }
            .store(in: &cancellables)

        // Periodic foreground timer to refresh elapsed times and time-based queues while idle
        Timer.publish(every: 2, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                self?.objectWillChange.send()
            }
            .store(in: &cancellables)

        Task {
            self.nextStart = await store.getNextStart()
            do {
                self.staffEmail = try await StoreFactory.currentStaffEmail()
            } catch {
                self.signInError = error.localizedDescription
            }
        }
    }

    public var orderView: OrderView {
        TokenRules.computeView(orders: orders)
    }

    public var typedToken: Int? {
        Int(typed)
    }

    public var currentMode: StaffTokenMode {
        guard let token = typedToken else { return .none }
        return StaffTokenMode.modeOf(token: token, in: orderView)
    }

    public var nextTokenSuggestion: Int {
        TokenRules.nextAvailableToken(currentOrders: orders, start: nextStart)
    }

    public var filteredPreparing: [Order] {
        let q = typed
        if q.isEmpty { return orderView.preparing }
        return orderView.preparing.filter { String($0.token).contains(q) }
    }

    public var filteredReady: [Order] {
        let q = typed
        if q.isEmpty { return orderView.ready }
        return orderView.ready.filter { String($0.token).contains(q) }
    }

    public var oldestPreparing: Order? {
        orderView.preparing.first
    }

    // MARK: - Keypad Actions
    public func pressKey(_ key: String) {
        HapticsService.light()
        if key == "Clear" {
            typed = ""
        } else if key == "Delete" {
            if !typed.isEmpty {
                typed.removeLast()
            }
        } else if typed.count < 3 { // Tokens range 1-150 (max 3 digits)
            let candidate = typed + key
            if let num = Int(candidate), num <= TokenRules.maxToken {
                typed = String(num) // eliminates leading zeros
            }
        }
    }

    public func handleMainAction() {
        guard let token = typedToken, TokenRules.isValidToken(token) else { return }
        let mode = currentMode
        typed = ""

        switch mode {
        case .preparing:
            callReady(token)
        case .ready:
            handOver(token)
        case .none:
            addToken(token)
        }
    }

    public func addToken(_ token: Int) {
        HapticsService.impact()
        Task { [weak self] in
            guard let self = self else { return }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            _ = try? await self.store.write(token: token, fields: OrderWriteFields(createdMs: now, readyMs: 0, collectedMs: 0))
            self.showToast("Token \(token) added") { [weak self] in
                self?.undoAddToken(token)
            }
        }
    }

    private func undoAddToken(_ token: Int) {
        Task { [weak self] in
            _ = try? await self?.store.write(token: token, fields: OrderWriteFields(collectedMs: Int64(Date().timeIntervalSince1970 * 1000)))
        }
    }

    public func callReady(_ token: Int) {
        HapticsService.impact()
        SoundService.shared.chime()
        Task { [weak self] in
            guard let self = self else { return }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            _ = try? await self.store.write(token: token, fields: OrderWriteFields(readyMs: now))
            self.showToast("Token \(token) is ready") { [weak self] in
                self?.undoCallReady(token)
            }
        }
    }

    private func undoCallReady(_ token: Int) {
        Task { [weak self] in
            _ = try? await self?.store.write(token: token, fields: OrderWriteFields(readyMs: 0))
        }
    }

    public func handOver(_ token: Int) {
        HapticsService.impact()
        Task { [weak self] in
            guard let self = self else { return }
            let now = Int64(Date().timeIntervalSince1970 * 1000)
            _ = try? await self.store.write(token: token, fields: OrderWriteFields(collectedMs: now))
            self.showToast("Token \(token) taken off") { [weak self] in
                self?.undoHandOver(token)
            }
        }
    }

    private func undoHandOver(_ token: Int) {
        Task { [weak self] in
            _ = try? await self?.store.write(token: token, fields: OrderWriteFields(collectedMs: 0))
        }
    }

    public func cancelPreparingOrder(_ token: Int) {
        handOver(token)
    }

    public func giveNextToken() {
        HapticsService.impact()
        Task { [weak self] in
            guard let self = self else { return }
            do {
                let prevNext = self.nextStart
                let n = try await self.store.issueNextToken()
                self.nextStart = (n % TokenRules.maxToken) + 1
                self.showToast("Give customer token \(n)") { [weak self] in
                    self?.undoGiveNextToken(n, prevNext: prevNext)
                }
            } catch {
                self.showToast(error.localizedDescription, undo: nil)
            }
        }
    }

    private func undoGiveNextToken(_ token: Int, prevNext: Int) {
        Task { [weak self] in
            _ = try? await self?.store.write(token: token, fields: OrderWriteFields(collectedMs: Int64(Date().timeIntervalSince1970 * 1000)))
            await self?.store.setNextStart(prevNext)
            self?.nextStart = prevNext
        }
    }

    public func restartNumberingAt1() {
        HapticsService.light()
        Task { [weak self] in
            guard let self = self else { return }
            await self.store.setNextStart(1)
            self.nextStart = 1
            self.showToast("Numbering restarts at 1", undo: nil)
        }
    }

    public func clearAllReady() {
        let readyList = orderView.ready
        guard !readyList.isEmpty else { return }

        let now = Int64(Date().timeIntervalSince1970 * 1000)
        Task { [weak self] in
            guard let self = self else { return }
            for o in readyList {
                _ = try? await self.store.write(token: o.token, fields: OrderWriteFields(collectedMs: now))
            }

            let msg = readyList.count == 1
                ? "Token \(readyList[0].token) taken off"
                : "\(readyList.count) ready tokens taken off"

            self.showToast(msg) { [weak self] in
                self?.undoClearAllReady(readyList)
            }
        }
    }

    private func undoClearAllReady(_ orders: [Order]) {
        Task { [weak self] in
            guard let self = self else { return }
            for o in orders {
                _ = try? await self.store.write(token: o.token, fields: OrderWriteFields(collectedMs: 0))
            }
        }
    }

    // MARK: - Toast helper
    public func showToast(_ message: String, undo: (() -> Void)? = nil) {
        toastTask?.cancel()
        toastMessage = message
        undoAction = undo
        showUndo = undo != nil

        toastTask = Task {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            if !Task.isCancelled {
                self.toastMessage = nil
                self.undoAction = nil
                self.showUndo = false
            }
        }
    }

    public func triggerUndo() {
        toastTask?.cancel()
        undoAction?()
        toastMessage = nil
        undoAction = nil
        showUndo = false
    }

    public func unlockWithPin(_ pin: String) -> Bool {
        if KeychainService.verifyPin(pin) {
            isUnlocked = true
            return true
        }
        return false
    }

    public var requiresStaffSignIn: Bool {
        StoreFactory.hasFirebaseConfig() && staffEmail == nil
    }

    public func signInStaff(email: String, password: String) async {
        isSigningIn = true
        signInError = nil
        defer { isSigningIn = false }
        do {
            staffEmail = try await StoreFactory.signInStaff(email: email, password: password)
        } catch {
            signInError = error.localizedDescription
        }
    }

    public func signOutStaff() {
        do {
            try StoreFactory.signOutStaff()
            staffEmail = nil
            isUnlocked = false
        } catch {
            signInError = error.localizedDescription
        }
    }
}
