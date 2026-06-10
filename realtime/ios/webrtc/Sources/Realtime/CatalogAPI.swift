import Foundation

struct LLMModelInfo: Decodable, Identifiable, Equatable {
    var model: String
    var provider: String?
    var modelCreator: String?
    var isSupported: Bool?

    var id: String { model }

    /// Realtime API expects a `provider/model` identifier (e.g. "openai/gpt-4o-mini",
    /// "inworld/models/GLM-5.1"), while list-models returns the model and provider
    /// separately. The model string may itself contain slashes, so prefix the provider
    /// unconditionally unless it is already present.
    var realtimeIdentifier: String {
        guard let provider, !provider.isEmpty else { return model }
        if model.hasPrefix("\(provider)/") { return model }
        return "\(provider)/\(model)"
    }
}

struct VoiceInfo: Decodable, Identifiable, Equatable {
    var voiceId: String
    var displayName: String?
    var langCode: String?
    var description: String?
    var gender: String?
    var source: String?

    var id: String { voiceId }
}

struct CatalogAPI {
    var credentials: RealtimeCredentials
    var session: URLSession = .shared

    private struct ModelsResponse: Decodable { var models: [LLMModelInfo]? }
    private struct VoicesResponse: Decodable {
        var voices: [VoiceInfo]?
        var nextPageToken: String?
    }

    func fetchModels() async throws -> [LLMModelInfo] {
        let url = credentials.apiBaseURL.appending(path: "llm/v1alpha/models")
        let data = try await get(url)
        let models = try JSONDecoder().decode(ModelsResponse.self, from: data).models ?? []
        return models.sorted { $0.realtimeIdentifier < $1.realtimeIdentifier }
    }

    func fetchVoices() async throws -> [VoiceInfo] {
        var voices: [VoiceInfo] = []
        var pageToken: String?
        repeat {
            var components = URLComponents(
                url: credentials.apiBaseURL.appending(path: "voices/v1/voices"),
                resolvingAgainstBaseURL: false
            )!
            var items = [URLQueryItem(name: "pageSize", value: "2000")]
            if let pageToken { items.append(URLQueryItem(name: "pageToken", value: pageToken)) }
            components.queryItems = items

            let data = try await get(components.url!)
            let page = try JSONDecoder().decode(VoicesResponse.self, from: data)
            voices.append(contentsOf: page.voices ?? [])
            pageToken = (page.nextPageToken?.isEmpty == false) ? page.nextPageToken : nil
        } while pageToken != nil

        return voices.sorted { ($0.displayName ?? $0.voiceId) < ($1.displayName ?? $1.voiceId) }
    }

    private func get(_ url: URL) async throws -> Data {
        var request = URLRequest(url: url)
        request.setValue(credentials.authorizationHeader, forHTTPHeaderField: "Authorization")
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw SignalingError.malformedResponse }
        guard (200..<300).contains(http.statusCode) else {
            throw SignalingError.httpError(http.statusCode, String(data: data, encoding: .utf8) ?? "")
        }
        return data
    }
}
