import Foundation
import Observation

@MainActor
@Observable
final class ConversationViewModel {
    private(set) var transcript: [TranscriptItem] = []
    private(set) var state: SessionState = .idle
    var isMicMuted = false {
        didSet { session?.setMicEnabled(!isMicMuted) }
    }

    private let settings: SettingsStore
    private var session: RealtimeSession?
    private var streamingAgentItemID: UUID?
    private var streamingUserItemID: UUID?

    init(settings: SettingsStore) {
        self.settings = settings
    }

    var isConnected: Bool { state == .connected }
    var isBusy: Bool { state == .connecting }

    var errorMessage: String? {
        if case .failed(let message) = state { return message }
        return nil
    }

    func connect() async {
        transcript = []
        streamingAgentItemID = nil
        streamingUserItemID = nil
        isMicMuted = false

        let session = RealtimeSession(
            authProvider: settings.makeAuthProvider(),
            config: settings.makeSessionConfig()
        )
        session.onStateChange = { [weak self] state in self?.state = state }
        session.onEvent = { [weak self] event in self?.handle(event) }
        self.session = session
        await session.connect()
    }

    func disconnect() {
        session?.disconnect()
        session = nil
        streamingAgentItemID = nil
        streamingUserItemID = nil
    }

    func handle(_ event: ServerEvent) {
        switch event {
        case .outputTextDelta(let delta):
            appendAgentDelta(delta)
        case .transcriptDone(let text):
            finalizeAgentItem(replacingWith: text)
        case .inputTranscriptionDelta(let delta):
            appendUserDelta(delta)
        case .inputTranscriptionCompleted(let transcript):
            finalizeUserItem(with: transcript)
        case .speechStarted:
            dropStreamingAgentItem()
        case .responseDone:
            finalizeAgentItem(replacingWith: nil)
        case .error(let message):
            state = .failed(message)
        case .outputItemAdded, .unknown,
             .backchannelAudioDelta, .backchannelAudioDone, .backchannelSkipped:
            // Back-channel audio is played in the realtime layer; phrase is telemetry, not transcript.
            break
        }
    }

    private func appendAgentDelta(_ delta: String) {
        guard !delta.isEmpty else { return }
        if let id = streamingAgentItemID, let index = transcript.firstIndex(where: { $0.id == id }) {
            transcript[index].text += delta
        } else {
            var item = TranscriptItem(role: .agent, text: delta)
            item.isStreaming = true
            streamingAgentItemID = item.id
            transcript.append(item)
        }
    }

    private func finalizeAgentItem(replacingWith text: String?) {
        guard let id = streamingAgentItemID,
              let index = transcript.firstIndex(where: { $0.id == id }) else {
            streamingAgentItemID = nil
            return
        }
        if let text, !text.isEmpty {
            transcript[index].text = text
        }
        transcript[index].isStreaming = false
        streamingAgentItemID = nil
    }

    private func appendUserDelta(_ delta: String) {
        guard !delta.isEmpty else { return }
        if let id = streamingUserItemID, let index = transcript.firstIndex(where: { $0.id == id }) {
            transcript[index].text = Self.reconcileTranscript(existing: transcript[index].text, delta: delta)
        } else {
            var item = TranscriptItem(role: .user, text: delta)
            item.isStreaming = true
            streamingUserItemID = item.id
            transcript.append(item)
        }
    }

    /// Some STT providers (e.g. Soniox) emit each partial as the FULL text-so-far rather
    /// than an incremental chunk, so blindly appending duplicates the transcript. The
    /// realtime contract intends `delta` to be incremental, but until the server normalizes
    /// it, tolerate both shapes. The final `completed` transcript is authoritative regardless.
    static func reconcileTranscript(existing: String, delta: String) -> String {
        if existing.isEmpty { return delta }
        if delta == existing { return existing }        // cumulative re-send of same text
        if delta.hasPrefix(existing) { return delta }   // cumulative growth → replace
        if existing.hasPrefix(delta) { return existing } // stale shorter snapshot → keep
        return existing + delta                          // genuine incremental chunk → append
    }

    private func finalizeUserItem(with transcript: String) {
        let trimmed = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        if let id = streamingUserItemID, let index = self.transcript.firstIndex(where: { $0.id == id }) {
            if !trimmed.isEmpty {
                self.transcript[index].text = trimmed
                self.transcript[index].isStreaming = false
            } else if self.transcript[index].text.isEmpty {
                // Nothing streamed and no final text: drop the empty bubble.
                self.transcript.remove(at: index)
            } else {
                // Empty final but real partials arrived: keep them, just stop streaming.
                self.transcript[index].isStreaming = false
            }
            streamingUserItemID = nil
        } else if !trimmed.isEmpty {
            // No partials arrived — append the final transcript directly.
            self.transcript.append(TranscriptItem(role: .user, text: trimmed))
        }
    }

    private func dropStreamingAgentItem() {
        if let id = streamingAgentItemID {
            transcript.removeAll { $0.id == id }
            streamingAgentItemID = nil
        }
    }
}
