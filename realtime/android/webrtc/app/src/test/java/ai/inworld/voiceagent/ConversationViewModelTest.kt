package ai.inworld.voiceagent

import ai.inworld.voiceagent.realtime.RealtimeSessionApi
import ai.inworld.voiceagent.realtime.events.ServerEvent
import ai.inworld.voiceagent.state.ConversationViewModel
import ai.inworld.voiceagent.state.Role
import ai.inworld.voiceagent.state.SessionState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationViewModelTest {
    private class FakeSession : RealtimeSessionApi {
        override val state = MutableStateFlow<SessionState>(SessionState.Idle)
        override val events = MutableSharedFlow<ServerEvent>()
        override suspend fun connect() {}
        override fun disconnect(failure: String?) {}
        override fun setMicEnabled(enabled: Boolean) {}
    }

    @Before
    fun setUp() {
        Dispatchers.setMain(StandardTestDispatcher())
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun makeViewModel() = ConversationViewModel(sessionFactory = { _, _ -> FakeSession() })

    @Test
    fun agentDeltaStreamingAndFinalize() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.OutputTextDelta("Hel"))
        vm.handle(ServerEvent.OutputTextDelta("lo!"))
        assertEquals(1, vm.transcript.size)
        assertEquals("Hello!", vm.transcript[0].text)
        assertTrue(vm.transcript[0].isStreaming)

        vm.handle(ServerEvent.TranscriptDone("Hello there!"))
        assertEquals("Hello there!", vm.transcript[0].text)
        assertFalse(vm.transcript[0].isStreaming)
    }

    @Test
    fun finalizeWithNullKeepsAccumulatedText() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.OutputTextDelta("Hi"))
        vm.handle(ServerEvent.ResponseDone)
        assertEquals("Hi", vm.transcript[0].text)
        assertFalse(vm.transcript[0].isStreaming)
    }

    @Test
    fun userTranscriptAppends() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.InputTranscriptionCompleted("What's up?"))
        assertEquals(1, vm.transcript.size)
        assertEquals(Role.User, vm.transcript[0].role)
        assertEquals("What's up?", vm.transcript[0].text)
    }

    @Test
    fun userPartialTranscriptStreamsThenFinalizes() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.InputTranscriptionDelta("what "))
        vm.handle(ServerEvent.InputTranscriptionDelta("time"))
        assertEquals(1, vm.transcript.size)
        assertEquals(Role.User, vm.transcript[0].role)
        assertEquals("what time", vm.transcript[0].text)
        assertTrue(vm.transcript[0].isStreaming)

        vm.handle(ServerEvent.InputTranscriptionCompleted("What time is it?"))
        assertEquals(1, vm.transcript.size)
        assertEquals("What time is it?", vm.transcript[0].text)
        assertFalse(vm.transcript[0].isStreaming)
    }

    @Test
    fun cumulativePartialsDoNotDuplicate() {
        // Soniox-style: each partial is the full text so far.
        val vm = makeViewModel()
        vm.handle(ServerEvent.InputTranscriptionDelta("what"))
        vm.handle(ServerEvent.InputTranscriptionDelta("what time"))
        vm.handle(ServerEvent.InputTranscriptionDelta("what time is it"))
        assertEquals(1, vm.transcript.size)
        assertEquals("what time is it", vm.transcript[0].text)
    }

    @Test
    fun reconcileTranscriptHandlesBothShapes() {
        // Cumulative
        assertEquals("what time", ConversationViewModel.reconcileTranscript("what", "what time"))
        // Duplicate cumulative re-send
        assertEquals("what time", ConversationViewModel.reconcileTranscript("what time", "what time"))
        // Stale shorter snapshot
        assertEquals("what time", ConversationViewModel.reconcileTranscript("what time", "what"))
        // Incremental chunk
        assertEquals("what time", ConversationViewModel.reconcileTranscript("what", " time"))
        // First chunk
        assertEquals("what", ConversationViewModel.reconcileTranscript("", "what"))
    }

    @Test
    fun secondUserTurnStartsNewBubble() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.InputTranscriptionDelta("hi"))
        vm.handle(ServerEvent.InputTranscriptionCompleted("Hi."))
        vm.handle(ServerEvent.InputTranscriptionDelta("bye"))
        assertEquals(2, vm.transcript.size)
        assertEquals("bye", vm.transcript[1].text)
        assertTrue(vm.transcript[1].isStreaming)
    }

    @Test
    fun emptyFinalKeepsStreamedPartialText() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.InputTranscriptionDelta("hello"))
        vm.handle(ServerEvent.InputTranscriptionCompleted("  "))
        assertEquals(1, vm.transcript.size)
        assertEquals("hello", vm.transcript[0].text)
        assertFalse(vm.transcript[0].isStreaming)
    }

    @Test
    fun bargeInDropsStreamingAgentBubble() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.OutputTextDelta("I was saying"))
        vm.handle(ServerEvent.SpeechStarted)
        assertTrue(vm.transcript.isEmpty())

        // New agent response after barge-in starts a fresh bubble
        vm.handle(ServerEvent.OutputTextDelta("Sure,"))
        assertEquals(1, vm.transcript.size)
        assertEquals("Sure,", vm.transcript[0].text)
    }

    @Test
    fun bargeInKeepsFinalizedBubbles() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.OutputTextDelta("Done answer"))
        vm.handle(ServerEvent.ResponseDone)
        vm.handle(ServerEvent.SpeechStarted)
        assertEquals(1, vm.transcript.size)
    }

    @Test
    fun newResponseAfterFinalizeStartsNewBubble() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.OutputTextDelta("First"))
        vm.handle(ServerEvent.ResponseDone)
        vm.handle(ServerEvent.OutputTextDelta("Second"))
        assertEquals(2, vm.transcript.size)
        assertEquals("Second", vm.transcript[1].text)
    }

    @Test
    fun emptyUserTranscriptIgnored() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.InputTranscriptionCompleted("  \n"))
        assertTrue(vm.transcript.isEmpty())
    }

    @Test
    fun errorEventFailsSession() {
        val vm = makeViewModel()
        vm.handle(ServerEvent.Error("boom"))
        assertEquals(SessionState.Failed("boom"), vm.uiState.value.sessionState)
    }
}
