import XCTest
@testable import InworldVoiceAgent

final class ServerEventDecodingTests: XCTestCase {
    private func decode(_ json: String) -> ServerEvent {
        ServerEvent.decode(Data(json.utf8))
    }

    func testOutputTextDeltaVariants() {
        for type in [
            "response.output_text.delta",
            "response.text.delta",
            "response.audio_transcript.delta",
            "response.output_audio_transcript.delta",
        ] {
            let event = decode(#"{"type": "\#(type)", "delta": "Hel"}"#)
            XCTAssertEqual(event, .outputTextDelta("Hel"), "for type \(type)")
        }
    }

    func testTranscriptDone() {
        let event = decode(#"{"type": "response.output_audio_transcript.done", "transcript": "Hello there."}"#)
        XCTAssertEqual(event, .transcriptDone("Hello there."))
    }

    func testContentPartDone() {
        let event = decode(#"{"type": "response.content_part.done", "part": {"transcript": "Hi!"}}"#)
        XCTAssertEqual(event, .transcriptDone("Hi!"))
    }

    func testContentPartDoneWithoutTranscript() {
        let event = decode(#"{"type": "response.content_part.done", "part": {}}"#)
        XCTAssertEqual(event, .transcriptDone(nil))
    }

    func testInputTranscriptionDelta() {
        let event = decode(#"{"type": "conversation.item.input_audio_transcription.delta", "item_id": "i1", "delta": "what"}"#)
        XCTAssertEqual(event, .inputTranscriptionDelta("what"))
    }

    func testInputTranscriptionCompleted() {
        let event = decode(#"{"type": "conversation.item.input_audio_transcription.completed", "transcript": "What time is it?"}"#)
        XCTAssertEqual(event, .inputTranscriptionCompleted("What time is it?"))
    }

    func testSpeechStarted() {
        XCTAssertEqual(decode(#"{"type": "input_audio_buffer.speech_started"}"#), .speechStarted)
    }

    func testOutputItemAdded() {
        XCTAssertEqual(decode(#"{"type": "response.output_item.added", "item": {}}"#), .outputItemAdded)
    }

    func testResponseDone() {
        XCTAssertEqual(decode(#"{"type": "response.done", "response": {"status": "completed"}}"#), .responseDone)
    }

    func testBackchannelAudioDelta() {
        let event = decode(#"{"type": "response.backchannel.audio.delta", "backchannel_id": "b1", "delta": "AAEC"}"#)
        XCTAssertEqual(event, .backchannelAudioDelta(base64PCM16: "AAEC"))
    }

    func testBackchannelAudioDone() {
        let event = decode(#"{"type": "response.backchannel.audio.done", "backchannel_id": "b1", "phrase": "uh-huh"}"#)
        XCTAssertEqual(event, .backchannelAudioDone(phrase: "uh-huh"))
    }

    func testBackchannelSkipped() {
        let event = decode(#"{"type": "response.backchannel.skipped", "backchannel_id": "b1", "reason": "deadline_missed"}"#)
        XCTAssertEqual(event, .backchannelSkipped(reason: "deadline_missed"))
    }

    func testErrorEvent() {
        let event = decode(#"{"type": "error", "error": {"message": "bad things"}}"#)
        XCTAssertEqual(event, .error("bad things"))
    }

    func testUnknownTypeNeverThrows() {
        XCTAssertEqual(decode(#"{"type": "response.output_audio.delta", "delta": "AAAA"}"#),
                       .unknown(type: "response.output_audio.delta"))
    }

    func testGarbageInput() {
        XCTAssertEqual(decode("not json"), .unknown(type: ""))
    }
}
