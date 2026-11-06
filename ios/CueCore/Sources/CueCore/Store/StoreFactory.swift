import Foundation
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

    private static func configureFirebaseIfNeeded() {
        guard !isFirebaseConfigured else { return }
        if FirebaseApp.app() == nil {
            FirebaseApp.configure()
        }
        isFirebaseConfigured = true
    }
}
