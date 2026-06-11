import Foundation

struct BasicAuthProvider: AuthProvider {
    var apiKey: String
    var apiBaseURL = URL(string: "https://api.inworld.ai")!

    func credentials() async throws -> RealtimeCredentials {
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { throw AuthError.missingAPIKey }
        return RealtimeCredentials(
            authorizationHeader: "Basic \(key)",
            apiBaseURL: apiBaseURL,
            callsURL: nil,
            preFetchedIceServers: nil
        )
    }
}
