import AVFoundation
import Foundation
import WebRTC

enum SessionState: Equatable {
    case idle
    case connecting
    case connected
    case failed(String)
}

struct SessionConfig {
    enum TurnDetection {
        case semanticVAD(eagerness: String)
        case serverVAD(threshold: Double?, prefixPaddingMs: Int?, silenceDurationMs: Int?, idleTimeoutMs: Int?)
    }

    struct BackchannelConfig {
        var maxPerTurn: Int
        var minGapMs: Int
        var minSpeechMs: Int
        var volumeGain: Double
        var deciderKind: String
        var ruleFireProbability: Double
    }

    struct ResponsivenessConfig {
        var initialWaitTimeoutMs: Int
        var maxInitialPerTurn: Int
        var minFillerGapMs: Int
        var maxTokens: Int
        var enableOnFirstReply: Bool
    }

    var model: String
    var instructions: String
    var temperature: Double?
    var maxOutputTokens: Int?

    var ttsModel: String
    var voice: String
    var speechSpeed: Double?

    var transcriptionModel: String?
    var transcriptionLanguage: String?
    var noiseReduction: String?
    var turnDetection: TurnDetection = .semanticVAD(eagerness: "high")
    var createResponse = true
    var interruptResponse = true

    var backchannel: BackchannelConfig?
    var responsiveness: ResponsivenessConfig?

    var greetingPrompt: String
}

@MainActor
final class RealtimeSession {
    private(set) var state: SessionState = .idle {
        didSet { onStateChange?(state) }
    }

    var onStateChange: ((SessionState) -> Void)?
    var onEvent: ((ServerEvent) -> Void)?

    private let authProvider: AuthProvider
    private let config: SessionConfig
    private var client: WebRTCClient?
    private let backchannelPlayer = BackchannelAudioPlayer()
    private var interrupted = false

    init(authProvider: AuthProvider, config: SessionConfig) {
        self.authProvider = authProvider
        self.config = config
    }

    func connect() async {
        guard state == .idle || isFailed else { return }
        state = .connecting
        do {
            guard await AVAudioApplication.requestRecordPermission() else {
                state = .failed("Microphone access denied. Enable it in iOS Settings.")
                return
            }

            let credentials = try await authProvider.credentials()
            let api = SignalingAPI(credentials: credentials)
            let iceServers = try await api.fetchIceServers()

            let client = try WebRTCClient(iceServers: iceServers)
            self.client = client
            wireCallbacks(client)

            let offerSDP = try await client.makeOfferSDP()
            let answerSDP = try await api.postOffer(sdp: offerSDP)
            try await client.setAnswer(sdp: answerSDP)
            AudioSessionController.overrideToSpeaker()
        } catch {
            disconnect(failure: error.localizedDescription)
        }
    }

    func disconnect(failure: String? = nil) {
        client?.close()
        client = nil
        backchannelPlayer.stop()
        interrupted = false
        AudioSessionController.deactivate()
        state = failure.map(SessionState.failed) ?? .idle
    }

    func setMicEnabled(_ enabled: Bool) {
        client?.setMicEnabled(enabled)
    }

    private var isFailed: Bool {
        if case .failed = state { return true }
        return false
    }

    private func wireCallbacks(_ client: WebRTCClient) {
        client.onDataChannelOpen = { [weak self] in
            Task { @MainActor in self?.sendInitialEvents() }
        }
        client.onServerEvent = { [weak self] event in
            Task { @MainActor in self?.handle(event) }
        }
        client.onConnectionStateChange = { [weak self] pcState in
            Task { @MainActor in self?.handleConnectionState(pcState) }
        }
    }

    private func sendInitialEvents() {
        guard let client else { return }
        client.send(SessionUpdateEvent(config: config))
        client.send(ConversationItemCreateEvent(userText: config.greetingPrompt))
        client.send(ResponseCreateEvent())
        state = .connected
    }

    private func handle(_ event: ServerEvent) {
        switch event {
        case .speechStarted:
            // Barge-in: silence the agent immediately, cancel its response.
            interrupted = true
            client?.setAgentAudioEnabled(false)
            client?.send(ResponseCancelEvent())
        case .outputItemAdded:
            if interrupted {
                client?.setAgentAudioEnabled(true)
                interrupted = false
            }
        case .backchannelAudioDelta(let base64PCM16):
            // Played independently of the WebRTC track so it stays audible during barge-in.
            backchannelPlayer.enqueue(base64PCM16: base64PCM16)
        default:
            break
        }
        onEvent?(event)
    }

    private func handleConnectionState(_ pcState: RTCPeerConnectionState) {
        switch pcState {
        case .failed:
            disconnect(failure: "Connection lost.")
        case .disconnected, .closed:
            if state == .connected { disconnect() }
        default:
            break
        }
    }
}
