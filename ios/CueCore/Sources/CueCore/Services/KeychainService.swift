import Foundation
import Security

public enum KeychainService {
    private static let serviceName = "in.sharan.orderboard.staff"
    private static let pinAccount = "staff_pin"
    private static let pinEnabledKey = "ob_staff_pin_enabled"
    private static let onboardingCompletedKey = "ob_staff_pin_onboarding_completed"
    #if targetEnvironment(simulator)
    private static let pinBackupKey = "ob_staff_pin_simulator_backup"
    #endif

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

        let updateAttributes: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock
        ]

        // 1. Try updating existing Keychain item
        let updateStatus = SecItemUpdate(query as CFDictionary, updateAttributes as CFDictionary)
        if updateStatus == errSecSuccess {
            isPinEnabled = true
            hasCompletedOnboarding = true
            #if targetEnvironment(simulator)
            UserDefaults.standard.removeObject(forKey: pinBackupKey)
            #endif
            return true
        }

        // 2. If item does not exist yet, add it
        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock

        let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
        if addStatus == errSecSuccess {
            isPinEnabled = true
            hasCompletedOnboarding = true
            #if targetEnvironment(simulator)
            UserDefaults.standard.removeObject(forKey: pinBackupKey)
            #endif
            return true
        } else if addStatus == errSecDuplicateItem {
            SecItemDelete(query as CFDictionary)
            let retryStatus = SecItemAdd(addQuery as CFDictionary, nil)
            if retryStatus == errSecSuccess {
                isPinEnabled = true
                hasCompletedOnboarding = true
                #if targetEnvironment(simulator)
                UserDefaults.standard.removeObject(forKey: pinBackupKey)
                #endif
                return true
            }
        }

        #if targetEnvironment(simulator)
        // In unentitled simulator sandbox environments only, fallback to local storage
        UserDefaults.standard.set(pin, forKey: pinBackupKey)
        isPinEnabled = true
        hasCompletedOnboarding = true
        return true
        #else
        // On physical production devices, Keychain failure is not masked by plaintext storage
        return false
        #endif
    }

    public static func getPin() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: pinAccount,
            kSecReturnData as String: kCFBooleanTrue as Any,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecSuccess, let data = item as? Data, let pin = String(data: data, encoding: .utf8), !pin.isEmpty {
            return pin
        }

        #if targetEnvironment(simulator)
        if let backupPin = UserDefaults.standard.string(forKey: pinBackupKey), !backupPin.isEmpty {
            return backupPin
        }
        #endif

        return nil
    }

    @discardableResult
    public static func deletePin() -> Bool {
        #if targetEnvironment(simulator)
        UserDefaults.standard.removeObject(forKey: pinBackupKey)
        #endif
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
