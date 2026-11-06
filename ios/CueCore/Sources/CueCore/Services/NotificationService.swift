import Foundation
import UserNotifications

public enum NotificationService {
    public static func requestPermission() async -> Bool {
        do {
            let center = UNUserNotificationCenter.current()
            let settings = await center.notificationSettings()
            if settings.authorizationStatus == .notDetermined {
                let granted = try await center.requestAuthorization(options: [.alert, .sound, .badge])
                return granted
            }
            return settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional
        } catch {
            return false
        }
    }

    public static func scheduleReadyNotification(token: Int) {
        let content = UNMutableNotificationContent()
        content.title = "Cue"
        content.body = "Your order is ready — token \(token)."
        content.sound = .default
        content.userInfo = ["token": token]

        // Fire immediately
        let trigger = UNTimeIntervalNotificationTrigger(timeInterval: 0.1, repeats: false)
        let identifier = "cue-ready-\(token)"
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)

        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("Failed to schedule notification for token \(token): \(error)")
            }
        }
    }

    public static func cancelNotification(token: Int) {
        let identifier = "cue-ready-\(token)"
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [identifier])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [identifier])
    }
}
