package ai.inworld.voiceagent

import ai.inworld.voiceagent.realtime.events.ServerEvent
import org.junit.Assert.assertEquals
import org.junit.Test

class ServerEventDecodingTest {
    @Test
    fun outputTextDeltaVariants() {
        for (type in listOf(
            "response.output_text.delta",
            "response.text.delta",
            "response.audio_transcript.delta",
            "response.output_audio_transcript.delta",
        )) {
            val event = ServerEvent.decode("""{"type": "$type", "delta": "Hel"}""")
            assertEquals("for type $type", ServerEvent.OutputTextDelta("Hel"), event)
        }
    }

    @Test
    fun transcriptDone() {
        val event = ServerEvent.decode("""{"type": "response.output_audio_transcript.done", "transcript": "Hello there."}""")
        assertEquals(ServerEvent.TranscriptDone("Hello there."), event)
    }

    @Test
    fun contentPartDone() {
        val event = ServerEvent.decode("""{"type": "response.content_part.done", "part": {"transcript": "Hi!"}}""")
        assertEquals(ServerEvent.TranscriptDone("Hi!"), event)
    }

    @Test
    fun contentPartDoneWithoutTranscript() {
        val event = ServerEvent.decode("""{"type": "response.content_part.done", "part": {}}""")
        assertEquals(ServerEvent.TranscriptDone(null), event)
    }

    @Test
    fun inputTranscriptionDelta() {
        val event = ServerEvent.decode(
            """{"type": "conversation.item.input_audio_transcription.delta", "item_id": "i1", "delta": "what"}""",
        )
        assertEquals(ServerEvent.InputTranscriptionDelta("what"), event)
    }

    @Test
    fun inputTranscriptionCompleted() {
        val event = ServerEvent.decode(
            """{"type": "conversation.item.input_audio_transcription.completed", "transcript": "What time is it?"}""",
        )
        assertEquals(ServerEvent.InputTranscriptionCompleted("What time is it?"), event)
    }

    @Test
    fun speechStarted() {
        assertEquals(ServerEvent.SpeechStarted, ServerEvent.decode("""{"type": "input_audio_buffer.speech_started"}"""))
    }

    @Test
    fun outputItemAdded() {
        assertEquals(ServerEvent.OutputItemAdded, ServerEvent.decode("""{"type": "response.output_item.added", "item": {}}"""))
    }

    @Test
    fun responseDone() {
        assertEquals(
            ServerEvent.ResponseDone,
            ServerEvent.decode("""{"type": "response.done", "response": {"status": "completed"}}"""),
        )
    }

    @Test
    fun backchannelAudioDelta() {
        val event = ServerEvent.decode("""{"type": "response.backchannel.audio.delta", "backchannel_id": "b1", "delta": "AAEC"}""")
        assertEquals(ServerEvent.BackchannelAudioDelta("AAEC"), event)
    }

    @Test
    fun backchannelAudioDone() {
        val event = ServerEvent.decode("""{"type": "response.backchannel.audio.done", "backchannel_id": "b1", "phrase": "uh-huh"}""")
        assertEquals(ServerEvent.BackchannelAudioDone("uh-huh"), event)
    }

    @Test
    fun backchannelSkipped() {
        val event = ServerEvent.decode("""{"type": "response.backchannel.skipped", "backchannel_id": "b1", "reason": "deadline_missed"}""")
        assertEquals(ServerEvent.BackchannelSkipped("deadline_missed"), event)
    }

    @Test
    fun errorEvent() {
        val event = ServerEvent.decode("""{"type": "error", "error": {"message": "bad things"}}""")
        assertEquals(ServerEvent.Error("bad things"), event)
    }

    @Test
    fun errorEventTopLevelMessage() {
        val event = ServerEvent.decode("""{"type": "error", "message": "top-level"}""")
        assertEquals(ServerEvent.Error("top-level"), event)
    }

    @Test
    fun unknownTypeNeverThrows() {
        assertEquals(
            ServerEvent.Unknown("response.output_audio.delta"),
            ServerEvent.decode("""{"type": "response.output_audio.delta", "delta": "AAAA"}"""),
        )
    }

    @Test
    fun garbageInput() {
        assertEquals(ServerEvent.Unknown(""), ServerEvent.decode("not json"))
    }
}
