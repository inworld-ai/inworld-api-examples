import AVFoundation
import OSLog

/// Plays back-channel interjections, which arrive as base64 PCM16 chunks on the data
/// channel (separate from the WebRTC remote track). Kept independent so it stays audible
/// while the user speaks — the docs require back-channels to be exempt from ducking.
///
/// The engine is built lazily on the first chunk, NOT at init: WebRTC only activates and
/// configures the shared audio session when a call connects, and an AVAudioEngine created
/// before that latches onto an invalid output format and fails to start.
final class BackchannelAudioPlayer {
    private static let log = Logger(subsystem: "ai.inworld.InworldVoiceAgent", category: "backchannel")

    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?

    /// Back-channel audio is the realtime output format's default: audio/pcm @ 24 kHz mono.
    private let format = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                       sampleRate: 24000,
                                       channels: 1,
                                       interleaved: false)!

    func enqueue(base64PCM16: String) {
        guard let data = Data(base64Encoded: base64PCM16), !data.isEmpty else {
            Self.log.error("back-channel chunk failed base64 decode")
            return
        }
        guard let player = ensureRunning(),
              let buffer = Self.makeBuffer(from: data, format: format) else { return }
        player.scheduleBuffer(buffer, completionHandler: nil)
        if !player.isPlaying { player.play() }
    }

    /// Tears the graph down so the next call rebuilds against a fresh, active session.
    func stop() {
        player?.stop()
        engine?.stop()
        player = nil
        engine = nil
    }

    private func ensureRunning() -> AVAudioPlayerNode? {
        if let engine, engine.isRunning, let player {
            return player
        }
        let engine = self.engine ?? AVAudioEngine()
        let player = self.player ?? AVAudioPlayerNode()
        if self.engine == nil {
            engine.attach(player)
            engine.connect(player, to: engine.mainMixerNode, format: format)
            self.engine = engine
            self.player = player
        }
        do {
            engine.prepare()
            try engine.start()
            player.play()
            return player
        } catch {
            Self.log.error("AVAudioEngine failed to start: \(error.localizedDescription, privacy: .public)")
            self.engine = nil
            self.player = nil
            return nil
        }
    }

    static func makeBuffer(from pcm16: Data, format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let sampleCount = pcm16.count / 2
        guard sampleCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(sampleCount)),
              let channel = buffer.floatChannelData else { return nil }
        buffer.frameLength = AVAudioFrameCount(sampleCount)
        pcm16.withUnsafeBytes { raw in
            let samples = raw.bindMemory(to: Int16.self)
            for i in 0..<sampleCount {
                channel[0][i] = Float(Int16(littleEndian: samples[i])) / 32768.0
            }
        }
        return buffer
    }
}
