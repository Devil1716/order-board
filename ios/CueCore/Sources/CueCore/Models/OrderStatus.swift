import Foundation

/// Status of an individual token from a customer/student perspective.
public struct StudentTokenState: Equatable {
    public enum Kind: String, Equatable {
        case waiting
        case youAreNext
        case preparing
        case ready
        case collected
        case timedOut
    }

    public let token: Int
    public let kind: Kind
    public let title: String
    public let subtitle: String
    public let ageText: String
    public let isReady: Bool
    public let showCollect: Bool

    public init(token: Int,
                kind: Kind,
                title: String,
                subtitle: String,
                ageText: String,
                isReady: Bool,
                showCollect: Bool) {
        self.token = token
        self.kind = kind
        self.title = title
        self.subtitle = subtitle
        self.ageText = ageText
        self.isReady = isReady
        self.showCollect = showCollect
    }

    /// Derives the student-facing state of a token given current order state and active prep queue
    public static func derive(token: Int,
                              order: Order?,
                              prepQueue: [Order],
                              nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
                              expiryMinutes: Int = TokenRules.defaultExpiryMinutes) -> StudentTokenState {
        let expMs = Int64(expiryMinutes * 60 * 1000)

        guard let o = order, !TokenRules.isStale(order: o, nowMs: nowMs) else {
            return StudentTokenState(
                token: token,
                kind: .waiting,
                title: "Waiting",
                subtitle: "Staff haven’t added this token yet.",
                ageText: "",
                isReady: false,
                showCollect: false
            )
        }

        if o.collectedMs > 0 {
            return StudentTokenState(
                token: token,
                kind: .collected,
                title: "Collected",
                subtitle: "Enjoy your food.",
                ageText: "",
                isReady: false,
                showCollect: false
            )
        }

        let isReady = o.readyMs > 0 && (nowMs - o.readyMs) <= expMs
        if isReady {
            let ageStr = TokenRules.formatAge(elapsedMs: nowMs - o.readyMs)
            return StudentTokenState(
                token: token,
                kind: .ready,
                title: "Ready",
                subtitle: "Collect it at the counter.",
                ageText: "Ready \(ageStr)",
                isReady: true,
                showCollect: true
            )
        }

        if o.readyMs > 0 {
            // Ready timestamp set but older than expiry window
            return StudentTokenState(
                token: token,
                kind: .timedOut,
                title: "Timed out",
                subtitle: "Ask at the counter.",
                ageText: "",
                isReady: false,
                showCollect: false
            )
        }

        // In prep queue
        let prepIndex = prepQueue.firstIndex(where: { $0.token == token }) ?? 0
        let queueAge = TokenRules.formatAge(elapsedMs: nowMs - o.createdMs)

        if prepIndex <= 0 {
            return StudentTokenState(
                token: token,
                kind: .youAreNext,
                title: "You’re next",
                subtitle: "Almost there — hang tight.",
                ageText: "\(queueAge) in queue",
                isReady: false,
                showCollect: false
            )
        }

        let aheadText = prepIndex == 1 ? "1 order ahead." : "\(prepIndex) orders ahead."
        return StudentTokenState(
            token: token,
            kind: .preparing,
            title: "Preparing",
            subtitle: aheadText,
            ageText: "\(queueAge) in queue",
            isReady: false,
            showCollect: false
        )
    }
}

/// Mode of a token for staff interactions
public enum StaffTokenMode: Equatable {
    case none
    case preparing
    case ready

    public static func modeOf(token: Int, in view: OrderView) -> StaffTokenMode {
        if view.preparing.contains(where: { $0.token == token }) {
            return .preparing
        }
        if view.ready.contains(where: { $0.token == token }) {
            return .ready
        }
        return .none
    }

    public func mainButtonTitle(for token: Int?) -> String {
        guard let token = token, token > 0 else {
            return "Add token"
        }
        switch self {
        case .none:
            return "Add token \(token)"
        case .preparing:
            return "Ready: \(token)"
        case .ready:
            return "Hand over: \(token)"
        }
    }

    public func hint(for token: Int?) -> String {
        guard let token = token, token > 0 else {
            return "The red button changes based on the number."
        }
        switch self {
        case .none:
            return "Not in the queue yet — tap Add."
        case .preparing:
            return "In the kitchen — tap Ready when it’s done."
        case .ready:
            return "Waiting for pickup — tap Hand over when given."
        }
    }
}
