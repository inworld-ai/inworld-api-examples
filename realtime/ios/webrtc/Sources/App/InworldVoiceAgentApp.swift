import SwiftUI

@main
struct InworldVoiceAgentApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            ConversationView()
                .environment(model)
        }
    }
}
