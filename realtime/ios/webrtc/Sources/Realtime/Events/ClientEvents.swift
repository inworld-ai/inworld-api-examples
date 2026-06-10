import Foundation

enum ClientEventEncoder {
    /// The realtime session schema is snake_case everywhere EXCEPT the single key
    /// `providerData`, which the Go server unmarshals as camelCase
    /// (`json:"providerData"`). A blanket .convertToSnakeCase would emit
    /// `provider_data`, which the server silently ignores — so back-channel and
    /// responsiveness never turn on. Convert everything except that one key.
    private static let camelCaseKeys: Set<String> = ["providerData"]

    static func encode(_ event: some Encodable) throws -> Data {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .custom { path in
            let key = path.last!
            if camelCaseKeys.contains(key.stringValue) { return key }
            return AnyCodingKey(stringValue: snakeCased(key.stringValue))
        }
        return try encoder.encode(event)
    }

    private static func snakeCased(_ value: String) -> String {
        var result = ""
        for character in value {
            if character.isUppercase {
                result.append("_")
                result.append(contentsOf: character.lowercased())
            } else {
                result.append(character)
            }
        }
        return result
    }

    private struct AnyCodingKey: CodingKey {
        var stringValue: String
        var intValue: Int? { nil }
        init(stringValue: String) { self.stringValue = stringValue }
        init?(intValue: Int) { nil }
    }
}

struct SessionUpdateEvent: Encodable {
    var type = "session.update"
    var session: Session

    struct Session: Encodable {
        var type = "realtime"
        var model: String
        var instructions: String
        var temperature: Double?
        var maxOutputTokens: Int?
        var outputModalities = ["audio", "text"]
        var audio: Audio
        var providerData: ProviderData?
    }

    struct ProviderData: Encodable {
        var backchannel: Backchannel?
        var responsiveness: Responsiveness?
    }

    struct Backchannel: Encodable {
        var enabled = true
        var maxPerTurn: Int
        var minGapMs: Int
        var minSpeechMs: Int
        var volumeGain: Double
        var deciderKind: String
        var ruleFireProbability: Double?
    }

    struct Responsiveness: Encodable {
        var enabled = true
        var initialWaitTimeoutMs: Int
        var maxInitialPerTurn: Int
        var minFillerGapMs: Int
        var maxTokens: Int
        var enableFillerOnFirstAssistantReply: Bool
    }

    struct Audio: Encodable {
        var input: Input
        var output: Output
    }

    struct Input: Encodable {
        var transcription: Transcription?
        var noiseReduction: NoiseReduction?
        var turnDetection: TurnDetection
    }

    struct Transcription: Encodable {
        var model: String?
        var language: String?
    }

    struct NoiseReduction: Encodable {
        var type: String
    }

    struct TurnDetection: Encodable {
        var type: String
        // semantic_vad only
        var eagerness: String?
        // server_vad only
        var threshold: Double?
        var prefixPaddingMs: Int?
        var silenceDurationMs: Int?
        var idleTimeoutMs: Int?
        var createResponse: Bool
        var interruptResponse: Bool
    }

    struct Output: Encodable {
        var model: String
        var voice: String
        var speed: Double?
    }

    init(config: SessionConfig) {
        let turnDetection: TurnDetection
        switch config.turnDetection {
        case .semanticVAD(let eagerness):
            turnDetection = TurnDetection(
                type: "semantic_vad",
                eagerness: eagerness,
                createResponse: config.createResponse,
                interruptResponse: config.interruptResponse
            )
        case .serverVAD(let threshold, let prefixPaddingMs, let silenceDurationMs, let idleTimeoutMs):
            turnDetection = TurnDetection(
                type: "server_vad",
                threshold: threshold,
                prefixPaddingMs: prefixPaddingMs,
                silenceDurationMs: silenceDurationMs,
                idleTimeoutMs: idleTimeoutMs,
                createResponse: config.createResponse,
                interruptResponse: config.interruptResponse
            )
        }

        var transcription: Transcription?
        if config.transcriptionModel != nil || config.transcriptionLanguage != nil {
            transcription = Transcription(
                model: config.transcriptionModel,
                language: config.transcriptionLanguage
            )
        }

        let backchannel = config.backchannel.map {
            Backchannel(
                maxPerTurn: $0.maxPerTurn,
                minGapMs: $0.minGapMs,
                minSpeechMs: $0.minSpeechMs,
                volumeGain: $0.volumeGain,
                deciderKind: $0.deciderKind,
                ruleFireProbability: $0.deciderKind == "rule" ? $0.ruleFireProbability : nil
            )
        }
        let responsiveness = config.responsiveness.map {
            Responsiveness(
                initialWaitTimeoutMs: $0.initialWaitTimeoutMs,
                maxInitialPerTurn: $0.maxInitialPerTurn,
                minFillerGapMs: $0.minFillerGapMs,
                maxTokens: $0.maxTokens,
                enableFillerOnFirstAssistantReply: $0.enableOnFirstReply
            )
        }
        let providerData = (backchannel != nil || responsiveness != nil)
            ? ProviderData(backchannel: backchannel, responsiveness: responsiveness)
            : nil

        session = Session(
            model: config.model,
            instructions: config.instructions,
            temperature: config.temperature,
            maxOutputTokens: config.maxOutputTokens,
            audio: Audio(
                input: Input(
                    transcription: transcription,
                    noiseReduction: config.noiseReduction.map(NoiseReduction.init(type:)),
                    turnDetection: turnDetection
                ),
                output: Output(
                    model: config.ttsModel,
                    voice: config.voice,
                    speed: config.speechSpeed
                )
            ),
            providerData: providerData
        )
    }
}

struct ConversationItemCreateEvent: Encodable {
    var type = "conversation.item.create"
    var item: Item

    struct Item: Encodable {
        var type = "message"
        var role = "user"
        var content: [Content]
    }

    struct Content: Encodable {
        var type = "input_text"
        var text: String
    }

    init(userText: String) {
        item = Item(content: [Content(text: userText)])
    }
}

struct ResponseCreateEvent: Encodable {
    var type = "response.create"
}

struct ResponseCancelEvent: Encodable {
    var type = "response.cancel"
}
