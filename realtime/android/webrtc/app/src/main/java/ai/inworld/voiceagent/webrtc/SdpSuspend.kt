package ai.inworld.voiceagent.webrtc

import kotlinx.coroutines.suspendCancellableCoroutine
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class WebRtcException(message: String?) : Exception(message ?: "WebRTC error")

private abstract class BaseSdpObserver : SdpObserver {
    override fun onCreateSuccess(sdp: SessionDescription) {}
    override fun onCreateFailure(error: String?) {}
    override fun onSetSuccess() {}
    override fun onSetFailure(error: String?) {}
}

suspend fun PeerConnection.awaitCreateOffer(constraints: MediaConstraints): SessionDescription =
    suspendCancellableCoroutine { cont ->
        createOffer(object : BaseSdpObserver() {
            override fun onCreateSuccess(sdp: SessionDescription) = cont.resume(sdp)
            override fun onCreateFailure(error: String?) = cont.resumeWithException(WebRtcException(error))
        }, constraints)
    }

suspend fun PeerConnection.awaitSetLocalDescription(sdp: SessionDescription): Unit =
    suspendCancellableCoroutine { cont ->
        setLocalDescription(object : BaseSdpObserver() {
            override fun onSetSuccess() = cont.resume(Unit)
            override fun onSetFailure(error: String?) = cont.resumeWithException(WebRtcException(error))
        }, sdp)
    }

suspend fun PeerConnection.awaitSetRemoteDescription(sdp: SessionDescription): Unit =
    suspendCancellableCoroutine { cont ->
        setRemoteDescription(object : BaseSdpObserver() {
            override fun onSetSuccess() = cont.resume(Unit)
            override fun onSetFailure(error: String?) = cont.resumeWithException(WebRtcException(error))
        }, sdp)
    }
