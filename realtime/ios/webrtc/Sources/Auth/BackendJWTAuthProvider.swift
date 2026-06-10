import Foundation

/// Fetches a short-lived JWT from a trusted backend (the JS example's `webrtc/jwt`
/// Node server) so no Inworld key/secret ships in the app.
struct BackendJWTAuthProvider: AuthProvider {
    var backendURL: String
    var session: URLSession = .shared

    private struct ConfigResponse: Decodable {
        var jwt: String
        var iceServers: [IceServer]?
        var url: String?

        enum CodingKeys: String, CodingKey {
            case jwt
            case iceServers = "ice_servers"
            case url
        }
    }

    func credentials() async throws -> RealtimeCredentials {
        guard let base = URL(string: backendURL) else { throw AuthError.invalidBackendURL }
        let configURL = base.appending(path: "api/config")
        let (data, response) = try await session.data(from: configURL)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            let status = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw AuthError.backendRequestFailed("HTTP \(status)")
        }
        let config: ConfigResponse
        do {
            config = try JSONDecoder().decode(ConfigResponse.self, from: data)
        } catch {
            throw AuthError.backendRequestFailed("invalid config payload")
        }
        var callsURL: URL?
        if let urlString = config.url, !urlString.isEmpty {
            guard let parsed = URL(string: urlString) else {
                throw AuthError.backendRequestFailed("backend returned an invalid calls url: \(urlString)")
            }
            callsURL = parsed
        }
        return RealtimeCredentials(
            authorizationHeader: "Bearer \(config.jwt)",
            apiBaseURL: URL(string: "https://api.inworld.ai")!,
            callsURL: callsURL,
            preFetchedIceServers: config.iceServers
        )
    }
}
