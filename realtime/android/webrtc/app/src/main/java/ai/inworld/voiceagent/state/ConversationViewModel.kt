package ai.inworld.voiceagent.state

import ai.inworld.voiceagent.realtime.RealtimeSessionApi
import ai.inworld.voiceagent.realtime.events.ServerEvent
import ai.inworld.voiceagent.storage.Settings
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ConversationUiState(
    val transcript: List<TranscriptItem> = emptyList(),
    val sessionState: SessionState = SessionState.Idle,
    val isMicMuted: Boolean = false,
) {
    val isConnected: Boolean get() = sessionState == SessionState.Connected
    val isBusy: Boolean get() = sessionState == SessionState.Connecting
    val errorMessage: String? get() = (sessionState as? SessionState.Failed)?.message
}

class ConversationViewModel(
    private val sessionFactory: (Settings, kotlinx.coroutines.CoroutineScope) -> RealtimeSessionApi,
) : ViewModel() {
    private val _uiState = MutableStateFlow(ConversationUiState())
    val uiState: StateFlow<ConversationUiState> = _uiState

    private var session: RealtimeSessionApi? = null
    private var collectJobs = mutableListOf<Job>()
    private var streamingAgentItemId: String? = null
    private var streamingUserItemId: String? = null

    fun connect(settings: Settings) {
        disconnect() // tear down any previous session and collectors before starting anew
        _uiState.update { it.copy(transcript = emptyList(), isMicMuted = false) }
        streamingAgentItemId = null
        streamingUserItemId = null

        val session = sessionFactory(settings, viewModelScope)
        this.session = session
        collectJobs += session.state
            .onEach { state -> _uiState.update { it.copy(sessionState = state) } }
            .launchIn(viewModelScope)
        collectJobs += session.events
            .onEach(::handle)
            .launchIn(viewModelScope)
        viewModelScope.launch { session.connect() }
    }

    fun disconnect() {
        session?.disconnect()
        session = null
        collectJobs.forEach { it.cancel() }
        collectJobs.clear()
        streamingAgentItemId = null
        streamingUserItemId = null
    }

    fun setMicMuted(muted: Boolean) {
        _uiState.update { it.copy(isMicMuted = muted) }
        session?.setMicEnabled(!muted)
    }

    override fun onCleared() {
        disconnect()
    }

    fun handle(event: ServerEvent) {
        when (event) {
            is ServerEvent.OutputTextDelta -> appendAgentDelta(event.delta)
            is ServerEvent.TranscriptDone -> finalizeAgentItem(replacingWith = event.transcript)
            is ServerEvent.InputTranscriptionDelta -> appendUserDelta(event.delta)
            is ServerEvent.InputTranscriptionCompleted -> finalizeUserItem(event.transcript)
            is ServerEvent.SpeechStarted -> dropStreamingAgentItem()
            is ServerEvent.ResponseDone -> finalizeAgentItem(replacingWith = null)
            is ServerEvent.Error -> _uiState.update { it.copy(sessionState = SessionState.Failed(event.message)) }
            // Back-channel audio is played in the realtime layer; phrase is telemetry, not transcript.
            is ServerEvent.OutputItemAdded, is ServerEvent.Unknown,
            is ServerEvent.BackchannelAudioDelta, is ServerEvent.BackchannelAudioDone,
            is ServerEvent.BackchannelSkipped,
            -> Unit
        }
    }

    val transcript: List<TranscriptItem> get() = _uiState.value.transcript

    private fun updateTranscript(transform: (List<TranscriptItem>) -> List<TranscriptItem>) {
        _uiState.update { it.copy(transcript = transform(it.transcript)) }
    }

    private fun appendAgentDelta(delta: String) {
        if (delta.isEmpty()) return
        val id = streamingAgentItemId
        val index = id?.let { transcript.indexOfFirst { item -> item.id == it } } ?: -1
        if (index >= 0) {
            updateTranscript { list ->
                list.toMutableList().apply { this[index] = this[index].copy(text = this[index].text + delta) }
            }
        } else {
            val item = TranscriptItem(role = Role.Agent, text = delta, isStreaming = true)
            streamingAgentItemId = item.id
            updateTranscript { it + item }
        }
    }

    private fun finalizeAgentItem(replacingWith: String?) {
        val id = streamingAgentItemId ?: return
        streamingAgentItemId = null
        val index = transcript.indexOfFirst { it.id == id }
        if (index < 0) return
        updateTranscript { list ->
            list.toMutableList().apply {
                val text = replacingWith?.takeIf { it.isNotEmpty() } ?: this[index].text
                this[index] = this[index].copy(text = text, isStreaming = false)
            }
        }
    }

    private fun appendUserDelta(delta: String) {
        if (delta.isEmpty()) return
        val id = streamingUserItemId
        val index = id?.let { transcript.indexOfFirst { item -> item.id == it } } ?: -1
        if (index >= 0) {
            updateTranscript { list ->
                list.toMutableList().apply {
                    this[index] = this[index].copy(text = reconcileTranscript(this[index].text, delta))
                }
            }
        } else {
            val item = TranscriptItem(role = Role.User, text = delta, isStreaming = true)
            streamingUserItemId = item.id
            updateTranscript { it + item }
        }
    }

    private fun finalizeUserItem(finalTranscript: String) {
        val trimmed = finalTranscript.trim()
        val id = streamingUserItemId
        val index = id?.let { transcript.indexOfFirst { item -> item.id == it } } ?: -1
        if (index >= 0) {
            updateTranscript { list ->
                list.toMutableList().apply {
                    when {
                        trimmed.isNotEmpty() -> this[index] = this[index].copy(text = trimmed, isStreaming = false)
                        this[index].text.isEmpty() -> removeAt(index) // nothing streamed, no final: drop
                        else -> this[index] = this[index].copy(isStreaming = false) // keep partials
                    }
                }
            }
            streamingUserItemId = null
        } else if (trimmed.isNotEmpty()) {
            // No partials arrived — append the final transcript directly.
            updateTranscript { it + TranscriptItem(role = Role.User, text = trimmed) }
        }
    }

    private fun dropStreamingAgentItem() {
        val id = streamingAgentItemId ?: return
        streamingAgentItemId = null
        updateTranscript { list -> list.filterNot { it.id == id } }
    }

    companion object {
        /** Some STT providers (e.g. Soniox) emit each partial as the FULL text-so-far rather
         *  than an incremental chunk, so blindly appending duplicates the transcript. Tolerate
         *  both shapes; the final `completed` transcript is authoritative regardless. */
        fun reconcileTranscript(existing: String, delta: String): String = when {
            existing.isEmpty() -> delta
            delta == existing -> existing // cumulative re-send of same text
            delta.startsWith(existing) -> delta // cumulative growth → replace
            existing.startsWith(delta) -> existing // stale shorter snapshot → keep
            else -> existing + delta // genuine incremental chunk → append
        }
    }
}
