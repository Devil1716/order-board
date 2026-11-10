import Foundation
import FirebaseCore
import FirebaseAuth
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

    public static func restoreStaffSession() async throws -> Bool {
        guard hasFirebaseConfig() else { return false }
        configureFirebaseIfNeeded()
        guard let user = Auth.auth().currentUser, !user.isAnonymous else {
            try? Auth.auth().signOut()
            return false
        }
        do {
            try await requireStaffAccount(userID: user.uid)
            return true
        } catch {
            try? Auth.auth().signOut()
            throw error
        }
    }

    public static func signInStaff(email: String, password: String) async throws {
        configureFirebaseIfNeeded()
        let result = try await Auth.auth().signIn(withEmail: email, password: password)
        do {
            try await requireStaffAccount(userID: result.user.uid)
        } catch {
            try? Auth.auth().signOut()
            throw error
        }
    }

    private static func requireStaffAccount(userID: String) async throws {
        let snapshot = try await Firestore.firestore().collection("staff").document(userID).getDocument()
        guard snapshot.exists else {
            throw NSError(
                domain: "CueStaff",
                code: 403,
                userInfo: [NSLocalizedDescriptionKey: "This account is not authorized for staff access."]
            )
        }
    }

    private static func configureFirebaseIfNeeded() {
        guard !isFirebaseConfigured else { return }
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        isFirebaseConfigured = true
    }
}
