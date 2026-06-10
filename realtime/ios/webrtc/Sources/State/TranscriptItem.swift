import Foundation

struct TranscriptItem: Identifiable, Equatable {
    enum Role {
        case user
        case agent
    }

    let id = UUID()
    var role: Role
    var text: String
    var isStreaming = false
}
