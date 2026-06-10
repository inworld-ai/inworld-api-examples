import Foundation
import Observation

enum AuthMode: String, CaseIterable, Identifiable {
    case basic
    case backendJWT

    var id: String { rawValue }

    var label: String {
        switch self {
        case .basic: "API Key (Basic)"
        case .backendJWT: "Backend JWT"
        }
    }
}

enum TurnDetectionMode: String, CaseIterable, Identifiable {
    case semanticVAD = "semantic_vad"
    case serverVAD = "server_vad"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .semanticVAD: "Semantic VAD"
        case .serverVAD: "Server VAD"
        }
    }
}

enum NoiseReductionMode: String, CaseIterable, Identifiable {
    case off
    case nearField = "near_field"
    case farField = "far_field"

    var id: String { rawValue }

    var label: String {
        switch self {
        case .off: "Server default"
        case .nearField: "Near field"
        case .farField: "Far field"
        }
    }
}

enum DeciderKind: String, CaseIterable, Identifiable {
    case llm
    case rule

    var id: String { rawValue }
    var label: String { rawValue.uppercased() }
}

enum SettingsCatalog {
    static let eagernessOptions = ["low", "medium", "high", "auto"]
    static let transcriptionModels = [
        "",  // server default
        "inworld/inworld-stt-1",
        "assemblyai/u3-rt-pro",
        "soniox/stt-rt-v4",
    ]
}

@Observable
final class SettingsStore {
    private static let apiKeyKeychainKey = "INWORLD_API_KEY"

    private let keychain: KeychainStore
    private let defaults: UserDefaults

    var apiKey: String {
        didSet {
            if apiKey.isEmpty {
                keychain.remove(forKey: Self.apiKeyKeychainKey)
            } else {
                keychain.set(apiKey, forKey: Self.apiKeyKeychainKey)
            }
        }
    }

    // Model
    var model: String { didSet { defaults.set(model, forKey: "model") } }
    var instructions: String { didSet { defaults.set(instructions, forKey: "instructions") } }
    var greetingPrompt: String { didSet { defaults.set(greetingPrompt, forKey: "greetingPrompt") } }
    var temperatureEnabled: Bool { didSet { defaults.set(temperatureEnabled, forKey: "temperatureEnabled") } }
    var temperature: Double { didSet { defaults.set(temperature, forKey: "temperature") } }
    /// 0 means "server default" (not sent).
    var maxOutputTokens: Int { didSet { defaults.set(maxOutputTokens, forKey: "maxOutputTokens") } }

    // Voice output
    var ttsModel: String { didSet { defaults.set(ttsModel, forKey: "ttsModel") } }
    var voice: String { didSet { defaults.set(voice, forKey: "voice") } }
    var speechSpeed: Double { didSet { defaults.set(speechSpeed, forKey: "speechSpeed") } }

    // Audio input
    var transcriptionModel: String { didSet { defaults.set(transcriptionModel, forKey: "transcriptionModel") } }
    var transcriptionLanguage: String { didSet { defaults.set(transcriptionLanguage, forKey: "transcriptionLanguage") } }
    var noiseReduction: NoiseReductionMode { didSet { defaults.set(noiseReduction.rawValue, forKey: "noiseReduction") } }

    // Turn detection
    var turnDetectionMode: TurnDetectionMode { didSet { defaults.set(turnDetectionMode.rawValue, forKey: "turnDetectionMode") } }
    var eagerness: String { didSet { defaults.set(eagerness, forKey: "eagerness") } }
    var vadThreshold: Double { didSet { defaults.set(vadThreshold, forKey: "vadThreshold") } }
    var prefixPaddingMs: Int { didSet { defaults.set(prefixPaddingMs, forKey: "prefixPaddingMs") } }
    var silenceDurationMs: Int { didSet { defaults.set(silenceDurationMs, forKey: "silenceDurationMs") } }
    /// 0 means "server default" (not sent).
    var idleTimeoutMs: Int { didSet { defaults.set(idleTimeoutMs, forKey: "idleTimeoutMs") } }
    var createResponse: Bool { didSet { defaults.set(createResponse, forKey: "createResponse") } }
    var interruptResponse: Bool { didSet { defaults.set(interruptResponse, forKey: "interruptResponse") } }

    // Back-channel (providerData.backchannel) — brief "uh-huh" interjections while the user speaks
    var backchannelEnabled: Bool { didSet { defaults.set(backchannelEnabled, forKey: "backchannelEnabled") } }
    var bcMaxPerTurn: Int { didSet { defaults.set(bcMaxPerTurn, forKey: "bcMaxPerTurn") } }
    var bcMinGapMs: Int { didSet { defaults.set(bcMinGapMs, forKey: "bcMinGapMs") } }
    var bcMinSpeechMs: Int { didSet { defaults.set(bcMinSpeechMs, forKey: "bcMinSpeechMs") } }
    var bcVolumeGain: Double { didSet { defaults.set(bcVolumeGain, forKey: "bcVolumeGain") } }
    var bcDeciderKind: DeciderKind { didSet { defaults.set(bcDeciderKind.rawValue, forKey: "bcDeciderKind") } }
    var bcRuleFireProbability: Double { didSet { defaults.set(bcRuleFireProbability, forKey: "bcRuleFireProbability") } }

    // Responsiveness (providerData.responsiveness) — low-latency filler before the main reply
    var responsivenessEnabled: Bool { didSet { defaults.set(responsivenessEnabled, forKey: "responsivenessEnabled") } }
    var respInitialWaitMs: Int { didSet { defaults.set(respInitialWaitMs, forKey: "respInitialWaitMs") } }
    var respMaxInitialPerTurn: Int { didSet { defaults.set(respMaxInitialPerTurn, forKey: "respMaxInitialPerTurn") } }
    var respMinFillerGapMs: Int { didSet { defaults.set(respMinFillerGapMs, forKey: "respMinFillerGapMs") } }
    var respMaxTokens: Int { didSet { defaults.set(respMaxTokens, forKey: "respMaxTokens") } }
    var respEnableOnFirstReply: Bool { didSet { defaults.set(respEnableOnFirstReply, forKey: "respEnableOnFirstReply") } }

    // Auth
    var authMode: AuthMode { didSet { defaults.set(authMode.rawValue, forKey: "authMode") } }
    var backendURL: String { didSet { defaults.set(backendURL, forKey: "backendURL") } }

    init(keychain: KeychainStore = KeychainStore(), defaults: UserDefaults = .standard) {
        self.keychain = keychain
        self.defaults = defaults
        apiKey = keychain.string(forKey: Self.apiKeyKeychainKey) ?? Secrets.inworldAPIKey

        model = defaults.string(forKey: "model") ?? "openai/gpt-4o-mini"
        instructions = defaults.string(forKey: "instructions")
            ?? "You are a friendly voice assistant. Keep responses brief."
        greetingPrompt = defaults.string(forKey: "greetingPrompt")
            ?? "Say hello and ask how you can help. One sentence max."
        temperatureEnabled = defaults.bool(forKey: "temperatureEnabled")
        temperature = defaults.object(forKey: "temperature") as? Double ?? 0.7
        maxOutputTokens = defaults.integer(forKey: "maxOutputTokens")

        ttsModel = defaults.string(forKey: "ttsModel") ?? "inworld-tts-2"
        voice = defaults.string(forKey: "voice") ?? "Clive"
        speechSpeed = defaults.object(forKey: "speechSpeed") as? Double ?? 1.0

        transcriptionModel = defaults.string(forKey: "transcriptionModel") ?? ""
        transcriptionLanguage = defaults.string(forKey: "transcriptionLanguage") ?? ""
        noiseReduction = NoiseReductionMode(rawValue: defaults.string(forKey: "noiseReduction") ?? "") ?? .off

        turnDetectionMode = TurnDetectionMode(rawValue: defaults.string(forKey: "turnDetectionMode") ?? "") ?? .semanticVAD
        eagerness = defaults.string(forKey: "eagerness") ?? "high"
        vadThreshold = defaults.object(forKey: "vadThreshold") as? Double ?? 0.5
        prefixPaddingMs = defaults.object(forKey: "prefixPaddingMs") as? Int ?? 300
        silenceDurationMs = defaults.object(forKey: "silenceDurationMs") as? Int ?? 500
        idleTimeoutMs = defaults.integer(forKey: "idleTimeoutMs")
        createResponse = defaults.object(forKey: "createResponse") as? Bool ?? true
        interruptResponse = defaults.object(forKey: "interruptResponse") as? Bool ?? true

        backchannelEnabled = defaults.bool(forKey: "backchannelEnabled")
        bcMaxPerTurn = defaults.object(forKey: "bcMaxPerTurn") as? Int ?? 3
        bcMinGapMs = defaults.object(forKey: "bcMinGapMs") as? Int ?? 4000
        bcMinSpeechMs = defaults.object(forKey: "bcMinSpeechMs") as? Int ?? 800
        bcVolumeGain = defaults.object(forKey: "bcVolumeGain") as? Double ?? 0.6
        bcDeciderKind = DeciderKind(rawValue: defaults.string(forKey: "bcDeciderKind") ?? "") ?? .llm
        bcRuleFireProbability = defaults.object(forKey: "bcRuleFireProbability") as? Double ?? 1.0

        responsivenessEnabled = defaults.bool(forKey: "responsivenessEnabled")
        respInitialWaitMs = defaults.object(forKey: "respInitialWaitMs") as? Int ?? 1200
        respMaxInitialPerTurn = defaults.object(forKey: "respMaxInitialPerTurn") as? Int ?? 1
        respMinFillerGapMs = defaults.object(forKey: "respMinFillerGapMs") as? Int ?? 8000
        respMaxTokens = defaults.object(forKey: "respMaxTokens") as? Int ?? 12
        respEnableOnFirstReply = defaults.bool(forKey: "respEnableOnFirstReply")

        authMode = AuthMode(rawValue: defaults.string(forKey: "authMode") ?? "") ?? .basic
        backendURL = defaults.string(forKey: "backendURL") ?? "http://localhost:3000"
    }

    func makeAuthProvider() -> AuthProvider {
        switch authMode {
        case .basic:
            BasicAuthProvider(apiKey: apiKey)
        case .backendJWT:
            BackendJWTAuthProvider(backendURL: backendURL)
        }
    }

    func makeSessionConfig() -> SessionConfig {
        let turnDetection: SessionConfig.TurnDetection = switch turnDetectionMode {
        case .semanticVAD:
            .semanticVAD(eagerness: eagerness)
        case .serverVAD:
            .serverVAD(
                threshold: vadThreshold,
                prefixPaddingMs: prefixPaddingMs,
                silenceDurationMs: silenceDurationMs,
                idleTimeoutMs: idleTimeoutMs > 0 ? idleTimeoutMs : nil
            )
        }
        return SessionConfig(
            model: model,
            instructions: instructions,
            temperature: temperatureEnabled ? temperature : nil,
            maxOutputTokens: maxOutputTokens > 0 ? maxOutputTokens : nil,
            ttsModel: ttsModel,
            voice: voice,
            speechSpeed: speechSpeed == 1.0 ? nil : speechSpeed,
            transcriptionModel: transcriptionModel.isEmpty ? nil : transcriptionModel,
            transcriptionLanguage: transcriptionLanguage.isEmpty ? nil : transcriptionLanguage,
            noiseReduction: noiseReduction == .off ? nil : noiseReduction.rawValue,
            turnDetection: turnDetection,
            createResponse: createResponse,
            interruptResponse: interruptResponse,
            backchannel: backchannelEnabled ? SessionConfig.BackchannelConfig(
                maxPerTurn: bcMaxPerTurn,
                minGapMs: bcMinGapMs,
                minSpeechMs: bcMinSpeechMs,
                volumeGain: bcVolumeGain,
                deciderKind: bcDeciderKind.rawValue,
                ruleFireProbability: bcRuleFireProbability
            ) : nil,
            responsiveness: responsivenessEnabled ? SessionConfig.ResponsivenessConfig(
                initialWaitTimeoutMs: respInitialWaitMs,
                maxInitialPerTurn: respMaxInitialPerTurn,
                minFillerGapMs: respMinFillerGapMs,
                maxTokens: respMaxTokens,
                enableOnFirstReply: respEnableOnFirstReply
            ) : nil,
            greetingPrompt: greetingPrompt
        )
    }
}
