import Foundation

struct IceServer: Decodable, Equatable {
    var urls: [String]
    var username: String?
    var credential: String?

    enum CodingKeys: String, CodingKey {
        case urls, username, credential
    }

    init(urls: [String], username: String? = nil, credential: String? = nil) {
        self.urls = urls
        self.username = username
        self.credential = credential
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        // "urls" may be a single string or an array of strings
        if let single = try? container.decode(String.self, forKey: .urls) {
            urls = [single]
        } else {
            urls = try container.decode([String].self, forKey: .urls)
        }
        username = try container.decodeIfPresent(String.self, forKey: .username)
        credential = try container.decodeIfPresent(String.self, forKey: .credential)
    }
}

struct RealtimeCredentials {
    var authorizationHeader: String
    var apiBaseURL: URL
    var callsURL: URL?
    var preFetchedIceServers: [IceServer]?
}

enum AuthError: LocalizedError {
    case missingAPIKey
    case invalidBackendURL
    case backendRequestFailed(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey: "Inworld API key is not set. Add it in Settings."
        case .invalidBackendURL: "Backend URL is invalid."
        case .backendRequestFailed(let detail): "Backend config request failed: \(detail)"
        }
    }
}

protocol AuthProvider {
    func credentials() async throws -> RealtimeCredentials
}
