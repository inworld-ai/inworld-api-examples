package ai.inworld.voiceagent.webrtc

import ai.inworld.voiceagent.audio.AudioDebugConfig
import ai.inworld.voiceagent.auth.IceServer
import android.content.Context
import android.media.MediaRecorder
import org.webrtc.AudioTrack
import org.webrtc.CandidatePairChangeEvent
import org.webrtc.DataChannel
import org.webrtc.IceCandidate
import org.webrtc.MediaConstraints
import org.webrtc.MediaStream
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.RtpReceiver
import org.webrtc.RtpTransceiver
import org.webrtc.SessionDescription
import org.webrtc.audio.JavaAudioDeviceModule
import java.nio.charset.StandardCharsets

class WebRtcClient(
    context: Context,
    iceServers: List<IceServer>,
    audioDebug: AudioDebugConfig,
) {
    companion object {
        @Volatile private var initialized = false

        fun initialize(context: Context) {
            if (initialized) return
            synchronized(this) {
                if (initialized) return
                PeerConnectionFactory.initialize(
                    PeerConnectionFactory.InitializationOptions.builder(context.applicationContext)
                        .createInitializationOptions(),
                )
                initialized = true
            }
        }
    }

    // Factory per session (not static, unlike iOS): the HW AEC flag lives on the
    // audio device module, which is frozen at factory creation — so the debug toggle
    // can only apply on the next connect.
    private val adm = JavaAudioDeviceModule.builder(context.applicationContext)
        .setUseHardwareAcousticEchoCanceler(audioDebug.useHardwareAec)
        .setUseHardwareNoiseSuppressor(audioDebug.useHardwareAec)
        .setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION)
        .createAudioDeviceModule()

    private val factory: PeerConnectionFactory = PeerConnectionFactory.builder()
        .setAudioDeviceModule(adm)
        .createPeerConnectionFactory()

    private val iceAwaiter = IceGatheringAwaiter()
    private val peerConnection: PeerConnection
    private val dataChannel: DataChannel
    private val localAudioTrack: AudioTrack

    @Volatile private var remoteAudioTrack: AudioTrack? = null

    var onDataChannelOpen: (() -> Unit)? = null
    var onServerMessage: ((String) -> Unit)? = null
    var onConnectionStateChange: ((PeerConnection.PeerConnectionState) -> Unit)? = null

    init {
        val rtcConfig = PeerConnection.RTCConfiguration(
            iceServers.map {
                PeerConnection.IceServer.builder(it.urls)
                    .setUsername(it.username ?: "")
                    .setPassword(it.credential ?: "")
                    .createIceServer()
            },
        ).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
        }

        peerConnection = factory.createPeerConnection(rtcConfig, PeerObserver())
            ?: throw WebRtcException("failed to create peer connection")

        dataChannel = peerConnection.createDataChannel(
            "oai-events",
            DataChannel.Init().apply { ordered = true },
        )
        dataChannel.registerObserver(object : DataChannel.Observer {
            override fun onBufferedAmountChange(previousAmount: Long) {}

            override fun onStateChange() {
                if (dataChannel.state() == DataChannel.State.OPEN) onDataChannelOpen?.invoke()
            }

            override fun onMessage(buffer: DataChannel.Buffer) {
                // Runs on the signaling thread; copy out of the direct ByteBuffer.
                val bytes = ByteArray(buffer.data.remaining())
                buffer.data.get(bytes)
                onServerMessage?.invoke(String(bytes, StandardCharsets.UTF_8))
            }
        })

        // AEC/NS constraints are inert in modern libwebrtc (the ADM flags above are the
        // real lever); pass none.
        val audioSource = factory.createAudioSource(MediaConstraints())
        localAudioTrack = factory.createAudioTrack("mic0", audioSource)
        peerConnection.addTrack(localAudioTrack, listOf("stream0"))
    }

    suspend fun makeOfferSdp(): String {
        val offer = peerConnection.awaitCreateOffer(MediaConstraints())
        peerConnection.awaitSetLocalDescription(offer)
        iceAwaiter.await(
            alreadyComplete = peerConnection.iceGatheringState() == PeerConnection.IceGatheringState.COMPLETE,
        )
        return peerConnection.localDescription?.description
            ?: throw WebRtcException("no local description after ICE gathering")
    }

    suspend fun setAnswer(sdp: String) {
        peerConnection.awaitSetRemoteDescription(SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    fun send(json: String): Boolean {
        if (dataChannel.state() != DataChannel.State.OPEN) return false
        val buffer = DataChannel.Buffer(java.nio.ByteBuffer.wrap(json.toByteArray()), false)
        return dataChannel.send(buffer)
    }

    fun setAgentAudioEnabled(enabled: Boolean) {
        remoteAudioTrack?.setEnabled(enabled)
    }

    fun setMicEnabled(enabled: Boolean) {
        localAudioTrack.setEnabled(enabled)
    }

    fun close() {
        // Dispose order matters — native crashes otherwise.
        runCatching { dataChannel.unregisterObserver() }
        runCatching { dataChannel.close() }
        runCatching { dataChannel.dispose() }
        runCatching { peerConnection.close() }
        runCatching { peerConnection.dispose() }
        runCatching { factory.dispose() }
        runCatching { adm.release() }
    }

    private inner class PeerObserver : PeerConnection.Observer {
        override fun onSignalingChange(state: PeerConnection.SignalingState) {}

        override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}

        override fun onIceConnectionReceivingChange(receiving: Boolean) {}

        override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {
            if (state == PeerConnection.IceGatheringState.COMPLETE) iceAwaiter.onGatheringComplete()
        }

        override fun onIceCandidate(candidate: IceCandidate) {
            iceAwaiter.onCandidate()
        }

        override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}

        override fun onSelectedCandidatePairChanged(event: CandidatePairChangeEvent) {}

        override fun onAddStream(stream: MediaStream) {}

        override fun onRemoveStream(stream: MediaStream) {}

        override fun onDataChannel(channel: DataChannel) {}

        override fun onRenegotiationNeeded() {}

        override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {
            onConnectionStateChange?.invoke(newState)
        }

        override fun onAddTrack(receiver: RtpReceiver, streams: Array<out MediaStream>) {
            (receiver.track() as? AudioTrack)?.let { remoteAudioTrack = it }
        }

        override fun onTrack(transceiver: RtpTransceiver) {
            (transceiver.receiver.track() as? AudioTrack)?.let { remoteAudioTrack = it }
        }
    }
}
