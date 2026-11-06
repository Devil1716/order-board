import Foundation

/// Represents a single order token matching the Firestore data shape `{ t, r, c }`.
/// - `token`: The token number (1–150). Firestore doc ID is `String(token)`.
/// - `createdMs`: Epoch timestamp in ms when the order was created (`t`).
/// - `readyMs`: Epoch timestamp in ms when marked ready (`r`), or 0 if preparing.
/// - `collectedMs`: Epoch timestamp in ms when handed over (`c`), or 0 if not collected.
public struct Order: Identifiable, Codable, Equatable, Hashable {
    public var id: Int { token }
    public let token: Int
    public var createdMs: Int64
    public var readyMs: Int64
    public var collectedMs: Int64

    public init(token: Int, createdMs: Int64 = Int64(Date().timeIntervalSince1970 * 1000), readyMs: Int64 = 0, collectedMs: Int64 = 0) {
        self.token = token
        self.createdMs = createdMs
        self.readyMs = readyMs
        self.collectedMs = collectedMs
    }

    /// Short keys used for serialization matching existing Firestore schema
    enum CodingKeys: String, CodingKey {
        case token = "n"
        case createdMs = "t"
        case readyMs = "r"
        case collectedMs = "c"
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        if let intToken = try? container.decode(Int.self, forKey: .token) {
            self.token = intToken
        } else if let strToken = try? container.decode(String.self, forKey: .token), let parsed = Int(strToken) {
            self.token = parsed
        } else {
            self.token = 0
        }
        self.createdMs = (try? container.decode(Int64.self, forKey: .createdMs)) ?? 0
        self.readyMs = (try? container.decode(Int64.self, forKey: .readyMs)) ?? 0
        self.collectedMs = (try? container.decode(Int64.self, forKey: .collectedMs)) ?? 0
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(token, forKey: .token)
        try container.encode(createdMs, forKey: .createdMs)
        try container.encode(readyMs, forKey: .readyMs)
        try container.encode(collectedMs, forKey: .collectedMs)
    }

    /// Converts to dictionary representation for Firestore writes `{ t, r, c }`
    public var firestoreData: [String: Any] {
        return [
            "t": createdMs,
            "r": readyMs,
            "c": collectedMs
        ]
    }
}

/// Fields to update on an existing or new order
public struct OrderWriteFields {
    public var createdMs: Int64?
    public var readyMs: Int64?
    public var collectedMs: Int64?

    public init(createdMs: Int64? = nil, readyMs: Int64? = nil, collectedMs: Int64? = nil) {
        self.createdMs = createdMs
        self.readyMs = readyMs
        self.collectedMs = collectedMs
    }
}

/// Snapshot of the live order board split into Preparing and Ready queues.
public struct OrderView: Equatable {
    public let preparing: [Order]
    public let ready: [Order]

    public init(preparing: [Order], ready: [Order]) {
        self.preparing = preparing
        self.ready = ready
    }
}
