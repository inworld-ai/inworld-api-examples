package ai.inworld.voiceagent.realtime

import ai.inworld.voiceagent.audio.AudioDebugConfig
import ai.inworld.voiceagent.audio.AudioSessionController
import ai.inworld.voiceagent.audio.BackchannelAudioPlayer
import ai.inworld.voiceagent.auth.AuthProvider
import ai.inworld.voiceagent.realtime.events.ConversationItemCreateEvent
import ai.inworld.voiceagent.realtime.events.EventJson
import ai.inworld.voiceagent.realtime.events.ResponseCancelEvent
import ai.inworld.voiceagent.realtime.events.ResponseCreateEvent
import ai.inworld.voiceagent.realtime.events.ServerEvent
import ai.inworld.voiceagent.realtime.events.SessionUpdateEvent
import ai.inworld.voiceagent.state.SessionState
import ai.inworld.voiceagent.webrtc.WebRtcClient
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch
import kotlinx.serialization.encodeToString
import org.webrtc.PeerConnection

interface RealtimeSessionApi {
    val state: StateFlow<SessionState>
    val events: SharedFlow<ServerEvent>
    suspend fun connect()
    fun disconnect(failure: String? = null)
    fun setMicEnabled(enabled: Boolean)
}

class RealtimeSession(
    private val context: Context,
    private val authProvider: AuthProvider,
    private val config: SessionConfig,
    private val audioDebug: AudioDebugConfig,
    private val scope: CoroutineScope,
) : RealtimeSessionApi {
    private val _state = MutableStateFlow<SessionState>(SessionState.Idle)
    override val state: StateFlow<SessionState> = _state

    private val _events = MutableSharedFlow<ServerEvent>(extraBufferCapacity = 256)
    override val events: SharedFlow<ServerEvent> = _events

    private val audioSession = AudioSessionController(context)
    private val backchannelPlayer = BackchannelAudioPlayer()
    private var client: WebRtcClient? = null

    @Volatile private var interrupted = false

    override suspend fun connect() {
        if (_state.value != SessionState.Idle && _state.value !is SessionState.Failed) return
        _state.value = SessionState.Connecting
        try {
            WebRtcClient.initialize(context)

            val credentials = authProvider.credentials()
            val api = SignalingApi(credentials)
            val iceServers = api.fetchIceServers()

            audioSession.configure(audioDebug)
            val client = WebRtcClient(context, iceServers, audioDebug)
            this.client = client
            wireCallbacks(client)

            val offerSdp = client.makeOfferSdp()
            val answerSdp = api.postOffer(offerSdp)
            client.setAnswer(answerSdp)
            audioSession.overrideToSpeaker()
        } catch (e: Exception) {
            disconnect(failure = e.message ?: "Connection failed.")
        }
    }

    override fun disconnect(failure: String?) {
        client?.close()
        client = null
        backchannelPlayer.stop()
        interrupted = false
        audioSession.deactivate()
        _state.value = failure?.let { SessionState.Failed(it) } ?: SessionState.Idle
    }

    override fun setMicEnabled(enabled: Boolean) {
        client?.setMicEnabled(enabled)
    }

    fun liveAudioDescription(): String = audioSession.liveDescription(audioDebug.useHardwareAec)

    private fun wireCallbacks(client: WebRtcClient) {
        client.onDataChannelOpen = {
            scope.launch { sendInitialEvents() }
        }
        client.onServerMessage = { text ->
            scope.launch { handle(ServerEvent.decode(text)) }
        }
        client.onConnectionStateChange = { pcState ->
            scope.launch { handleConnectionState(pcState) }
        }
    }

    private fun sendInitialEvents() {
        val client = client ?: return
        client.send(EventJson.encodeToString(SessionUpdateEvent.from(config)))
        client.send(EventJson.encodeToString(ConversationItemCreateEvent.userText(config.greetingPrompt)))
        client.send(EventJson.encodeToString(ResponseCreateEvent()))
        _state.value = SessionState.Connected
    }

    private fun handle(event: ServerEvent) {
        when (event) {
            is ServerEvent.SpeechStarted -> {
                // Barge-in: silence the agent immediately, cancel its response.
                interrupted = true
                client?.setAgentAudioEnabled(false)
                client?.send(EventJson.encodeToString(ResponseCancelEvent()))
            }
            is ServerEvent.OutputItemAdded -> {
                if (interrupted) {
                    client?.setAgentAudioEnabled(true)
                    interrupted = false
                }
            }
            is ServerEvent.BackchannelAudioDelta ->
                // Played independently of the WebRTC track so it stays audible during barge-in.
                backchannelPlayer.enqueue(event.base64Pcm16)
            else -> Unit
        }
        _events.tryEmit(event)
    }

    private fun handleConnectionState(pcState: PeerConnection.PeerConnectionState) {
        when (pcState) {
            PeerConnection.PeerConnectionState.FAILED -> disconnect(failure = "Connection lost.")
            PeerConnection.PeerConnectionState.DISCONNECTED,
            PeerConnection.PeerConnectionState.CLOSED,
            -> if (_state.value == SessionState.Connected) disconnect()
            else -> Unit
        }
    }
}
