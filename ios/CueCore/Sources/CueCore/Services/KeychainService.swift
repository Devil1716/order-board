import Foundation
import Security

public enum KeychainService {
    private static let serviceName = "in.sharan.orderboard.staff"
    private static let pinAccount = "staff_pin"
    private static let pinEnabledKey = "ob_staff_pin_enabled"
    private static let onboardingCompletedKey = "ob_staff_pin_onboarding_completed"

    /// Tracks whether the staff PIN onboarding (set/confirm/skip) has been completed
    public static var hasCompletedOnboarding: Bool {
        get {
            UserDefaults.standard.bool(forKey: onboardingCompletedKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: onboardingCompletedKey)
        }
    }

    public static var isPinEnabled: Bool {
        get {
            // Default to true if a PIN has been set
            if UserDefaults.standard.object(forKey: pinEnabledKey) == nil {
                return getPin() != nil
            }
            return UserDefaults.standard.bool(forKey: pinEnabledKey)
        }
        set {
            UserDefaults.standard.set(newValue, forKey: pinEnabledKey)
        }
    }

    @discardableResult
    public static func savePin(_ pin: String) -> Bool {
        guard let data = pin.data(using: .utf8) else { return false }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: pinAccount
        ]

        // Check if an item already exists
        let matchStatus = SecItemCopyMatching(query as CFDictionary, nil)
        if matchStatus == errSecSuccess {
            // Update existing without deleting first, preserving old PIN if update fails
            let updateAttributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
            ]
            let updateStatus = SecItemUpdate(query as CFDictionary, updateAttributes as CFDictionary)
            if updateStatus == errSecSuccess {
                isPinEnabled = true
                hasCompletedOnboarding = true
                return true
            }
            return false
        } else {
            // Add new item
            var addQuery = query
            addQuery[kSecValueData as String] = data
            addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

            let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if addStatus == errSecSuccess {
                isPinEnabled = true
                hasCompletedOnboarding = true
                return true
            }
            return false
        }
    }

    public static func getPin() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: pinAccount,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else {
            return nil
        }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    public static func deletePin() -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: pinAccount
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound
    }

    public static func hasPin() -> Bool {
        return getPin() != nil
    }

    public static func verifyPin(_ pin: String) -> Bool {
        guard let saved = getPin() else { return true }
        return saved == pin
    }
}
