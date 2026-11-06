import Foundation

/// Core domain rules matching the web prototype:
/// - Token pool: 1–150
/// - Ready expiry: 20 minutes
/// - Order stale window: 4 hours from creation timestamp
public enum TokenRules {
    public static let minToken: Int = 1
    public static let maxToken: Int = 150
    public static let defaultExpiryMinutes: Int = 20
    public static let expiryMs: Int64 = Int64(defaultExpiryMinutes * 60 * 1000)
    public static let staleWindowHours: Int = 4
    public static let staleWindowMs: Int64 = Int64(staleWindowHours * 3600 * 1000)

    /// Validates if a token number is in the allowed range 1–150
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

    /// Suggests the next available token within 1–150 starting from `start`,
    /// skipping any tokens currently in preparing or ready status.
    /// Returns 0 if all 150 tokens are currently in use.
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
