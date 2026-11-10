import Foundation
import FirebaseAuth
import FirebaseCore
import FirebaseFirestore

public enum StoreFactory {
    private static var isFirebaseConfigured = false

    /// Creates the appropriate `BoardStore` instance.
    /// If `GoogleService-Info.plist` is present in the main bundle, configures Firebase and returns
    /// `FirestoreBoardStore`. Otherwise, falls back to `LocalBoardStore` with offline label.
    public static func createStore() -> BoardStore {
        if hasFirebaseConfig() {
            configureFirebaseIfNeeded()
            return FirestoreBoardStore()
        } else {
            return LocalBoardStore()
        }
    }

    /// Checks if a valid `GoogleService-Info.plist` exists in the application bundle
    public static func hasFirebaseConfig() -> Bool {
        return Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
    }

    public static func currentStaffEmail() async throws -> String? {
        guard hasFirebaseConfig() else { return nil }
        configureFirebaseIfNeeded()
        guard let user = Auth.auth().currentUser else { return nil }
        try await requireStaffClaim(for: user)
        return user.email
    }

    public static func signInStaff(email: String, password: String) async throws -> String? {
        configureFirebaseIfNeeded()
        let result = try await Auth.auth().signIn(withEmail: email, password: password)
        do {
            try await requireStaffClaim(for: result.user, forcingRefresh: true)
        } catch {
            try? Auth.auth().signOut()
            throw error
        }
        return result.user.email
    }

    public static func signOutStaff() throws {
        try Auth.auth().signOut()
    }

    private static func configureFirebaseIfNeeded() {
        guard !isFirebaseConfigured else { return }
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        isFirebaseConfigured = true
    }

    private static func requireStaffClaim(for user: User, forcingRefresh: Bool = false) async throws {
        let token = try await user.getIDTokenResult(forcingRefresh: forcingRefresh)
        let claims = token.claims
        guard (claims["staff"] as? Bool == true) || (claims["role"] as? String == "staff") else {
            throw NSError(
                domain: "CueStaffAuth",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "This account is not authorized for staff access."]
            )
        }
    }
}
