// xcode: set sdk=iOS

import SwiftUI
import CueCore

@main
struct CueApp: App {
    var body: some Scene {
        WindowGroup {
            CueStudentContentView()
                .cueUpdateGate(.student)
        }
    }
}
