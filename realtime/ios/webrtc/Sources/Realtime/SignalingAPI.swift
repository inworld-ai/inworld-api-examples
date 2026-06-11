import Foundation

enum SignalingError: LocalizedError {
    case httpError(Int, String)
    case malformedResponse

    var errorDescription: String? {
        switch self {
        case .httpError(let status, let body):
            "Inworld API error (HTTP \(status)): \(body.prefix(200))"
        case .malformedResponse:
            "Malformed response from Inworld API."
        }
    }
}

struct SignalingAPI {
    var credentials: RealtimeCredentials
    var session: URLSession = .shared

    private struct IceServersResponse: Decodable {
        var iceServers: [IceServer]

        enum CodingKeys: String, CodingKey {
            case iceServers = "ice_servers"
        }
    }

    func fetchIceServers() async throws -> [IceServer] {
        if let preFetched = credentials.preFetchedIceServers {
            return preFetched
        }
        var request = URLRequest(url: credentials.apiBaseURL.appending(path: "v1/realtime/ice-servers"))
        request.setValue(credentials.authorizationHeader, forHTTPHeaderField: "Authorization")
        let data = try await perform(request)
        return try JSONDecoder().decode(IceServersResponse.self, from: data).iceServers
    }

    func postOffer(sdp: String) async throws -> String {
        let url = credentials.callsURL ?? credentials.apiBaseURL.appending(path: "v1/realtime/calls")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue(credentials.authorizationHeader, forHTTPHeaderField: "Authorization")
        request.setValue("application/sdp", forHTTPHeaderField: "Content-Type")
        request.httpBody = Data(sdp.utf8)
        let data = try await perform(request)
        guard let answer = String(data: data, encoding: .utf8), !answer.isEmpty else {
            throw SignalingError.malformedResponse
        }
        return answer
    }

    private func perform(_ request: URLRequest) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SignalingError.malformedResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw SignalingError.httpError(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }
}
