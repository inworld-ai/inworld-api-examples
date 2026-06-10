import Foundation

enum ServerEvent: Equatable {
    case outputTextDelta(String)
    case transcriptDone(String?)
    case inputTranscriptionDelta(String)
    case inputTranscriptionCompleted(String)
    case speechStarted
    case outputItemAdded
    case responseDone
    case backchannelAudioDelta(base64PCM16: String)
    case backchannelAudioDone(phrase: String?)
    case backchannelSkipped(reason: String)
    case error(String)
    case unknown(type: String)

    static func decode(_ data: Data) -> ServerEvent {
        guard let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let type = obj["type"] as? String else {
            return .unknown(type: "")
        }
        switch type {
        case "response.output_text.delta",
             "response.text.delta",
             "response.audio_transcript.delta",
             "response.output_audio_transcript.delta":
            return .outputTextDelta(obj["delta"] as? String ?? "")
        case "response.output_audio_transcript.done":
            return .transcriptDone(obj["transcript"] as? String)
        case "response.content_part.done":
            let part = obj["part"] as? [String: Any]
            return .transcriptDone(part?["transcript"] as? String)
        case "conversation.item.input_audio_transcription.delta":
            return .inputTranscriptionDelta(obj["delta"] as? String ?? "")
        case "conversation.item.input_audio_transcription.completed":
            return .inputTranscriptionCompleted(obj["transcript"] as? String ?? "")
        case "input_audio_buffer.speech_started":
            return .speechStarted
        case "response.output_item.added":
            return .outputItemAdded
        case "response.done":
            return .responseDone
        case "response.backchannel.audio.delta":
            return .backchannelAudioDelta(base64PCM16: obj["delta"] as? String ?? "")
        case "response.backchannel.audio.done":
            return .backchannelAudioDone(phrase: obj["phrase"] as? String)
        case "response.backchannel.skipped":
            return .backchannelSkipped(reason: obj["reason"] as? String ?? "")
        case "error":
            let error = obj["error"] as? [String: Any]
            let message = error?["message"] as? String ?? obj["message"] as? String ?? "unknown error"
            return .error(message)
        default:
            return .unknown(type: type)
        }
    }
}
