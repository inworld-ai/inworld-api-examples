package ai.inworld.voiceagent.webrtc

import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.withTimeoutOrNull

/** Waits for ICE gathering: resolves on COMPLETE, on [quietMs] with no new candidates,
 *  or at the [capMs] hard cap — candidates are embedded in the local SDP either way. */
class IceGatheringAwaiter(
    private val capMs: Long = 3_000,
    private val quietMs: Long = 500,
) {
    enum class Signal { Candidate, Complete }

    private val signals = Channel<Signal>(Channel.UNLIMITED)

    fun onCandidate() {
        signals.trySend(Signal.Candidate)
    }

    fun onGatheringComplete() {
        signals.trySend(Signal.Complete)
    }

    suspend fun await(alreadyComplete: Boolean = false) {
        if (alreadyComplete) return
        withTimeoutOrNull(capMs) {
            while (true) {
                val signal = withTimeoutOrNull(quietMs) { signals.receive() } ?: break
                if (signal == Signal.Complete) break
            }
        }
    }
}
