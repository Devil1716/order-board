import Foundation

/// Core domain rules matching the web prototype:
/// - Token pool: 1–200
/// - Ready expiry: 20 minutes
/// - Order stale window: 4 hours from creation timestamp
public enum TokenRules {
    public static let minToken: Int = 1
    public static let maxToken: Int = 200

    /// Built-in values. They equal the limits enforced by `firestore.rules` and `shared/js/token-rules.js`.
    public static let baseExpiryMinutes: Int = 20
    public static let baseStaleWindowHours: Int = 4

    private static let lock = NSLock()
    private static var _expiryMinutes: Int = baseExpiryMinutes
    private static var _staleWindowHours: Int = baseStaleWindowHours

    /// Minutes a ready order keeps its token. Remote Config may lengthen it, never shorten it.
    public static var defaultExpiryMinutes: Int {
        lock.lock(); defer { lock.unlock() }
        return _expiryMinutes
    }

    /// Hours after which an order is stale. Remote Config may lengthen it, never shorten it.
    public static var staleWindowHours: Int {
        lock.lock(); defer { lock.unlock() }
        return _staleWindowHours
    }

    public static var expiryMs: Int64 { Int64(defaultExpiryMinutes) * 60 * 1000 }
    public static var staleWindowMs: Int64 { Int64(staleWindowHours) * 3600 * 1000 }

    /// Applies server-driven thresholds. Values are clamped to [base, max]: `firestore.rules` holds a token
    /// for the base values (minus a 1 min grace), so a shorter client window would have re-issue writes rejected.
    /// Shortening the real limits needs a rules deploy plus an app release, not Remote Config.
    public static func applyRemote(expiryMinutes: Int?, staleWindowHours: Int?) {
        lock.lock(); defer { lock.unlock() }
        _expiryMinutes = min(max(expiryMinutes ?? baseExpiryMinutes, baseExpiryMinutes), 120)
        _staleWindowHours = min(max(staleWindowHours ?? baseStaleWindowHours, baseStaleWindowHours), 24)
    }

    /// Restores the built-in thresholds (used by tests).
    public static func resetRemote() {
        applyRemote(expiryMinutes: nil, staleWindowHours: nil)
    }

    /// True while an order still holds its token: not stale, not collected, and (if ready) ready for at most
    /// the expiry window. Same formula as `isTaken` in `shared/js/token-rules.js`.
    public static func isTaken(_ order: Order?, nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Bool {
        guard let order else { return false }
        if nowMs - order.createdMs > staleWindowMs || order.collectedMs != 0 { return false }
        return order.readyMs == 0 || nowMs - order.readyMs <= expiryMs
    }

    /// Validates if a token number is in the allowed range 1–200
    public static func isValidToken(_ token: Int) -> Bool {
        return token >= minToken && token <= maxToken
    }

    /// Determines if an order is stale (older than 4 hours based on creation timestamp)
    public static func isStale(order: Order, nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Bool {
        return (nowMs - order.createdMs) > staleWindowMs
    }

    /// Filters and categorizes orders into Preparing and Ready queues.
    /// Orders older than 4 hours or already collected are omitted.
    public static func computeView(orders: [Order],
                                   nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000),
                                   expiryMinutes: Int = defaultExpiryMinutes) -> OrderView {
        let expMs = Int64(expiryMinutes * 60 * 1000)
        var prep: [Order] = []
        var rd: [Order] = []

        for order in orders {
            // Ignore orders older than 4 hours or already collected
            if (nowMs - order.createdMs) > staleWindowMs || order.collectedMs > 0 {
                continue
            }

            if order.readyMs > 0 {
                // If ready and not expired
                if (nowMs - order.readyMs) <= expMs {
                    rd.append(order)
                }
            } else {
                // Not marked ready -> preparing
                prep.append(order)
            }
        }

        // Prep queue is sorted by creation time ascending (oldest order first)
        prep.sort { $0.createdMs < $1.createdMs }

        // Ready queue is sorted by ready time descending (newest ready first)
        rd.sort { $0.readyMs > $1.readyMs }

        return OrderView(preparing: prep, ready: rd)
    }

    /// Suggests the next available token within 1–200 starting from `start`,
    /// skipping any tokens currently in preparing or ready status.
    /// Returns 0 if all 200 tokens are currently in use.
    public static func nextAvailableToken(currentOrders: [Order],
                                          start: Int = 1,
                                          nowMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000)) -> Int {
        let view = computeView(orders: currentOrders, nowMs: nowMs)
        var used = Set<Int>()
        for o in view.preparing { used.insert(o.token) }
        for o in view.ready { used.insert(o.token) }

        let safeStart = isValidToken(start) ? start : 1
        for k in 0..<maxToken {
            let candidate = (safeStart - 1 + k) % maxToken + 1
            if !used.contains(candidate) {
                return candidate
            }
        }
        return 0
    }

    /// Formats elapsed time in minutes from a timestamp delta
    public static func formatAge(elapsedMs: Int64) -> String {
        let minutes = Int(elapsedMs / 60000)
        if minutes < 1 { return "Just now" }
        if minutes == 1 { return "1 min" }
        return "\(minutes) min"
    }

    /// Compact format for staff tiles: `<1m` or `5m`
    public static func formatCompactAge(elapsedMs: Int64) -> String {
        let minutes = Int(elapsedMs / 60000)
        if minutes < 1 { return "<1m" }
        return "\(minutes)m"
    }
}
