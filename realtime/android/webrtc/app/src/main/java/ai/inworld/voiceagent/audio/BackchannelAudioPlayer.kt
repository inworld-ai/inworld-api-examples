package ai.inworld.voiceagent.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import java.util.concurrent.Executors
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

/** Plays back-channel interjections, which arrive as base64 PCM16 (24 kHz mono) chunks on
 *  the data channel — separate from the WebRTC remote track. USAGE_VOICE_COMMUNICATION
 *  puts it on the call stream, so it stays audible while the user speaks and follows the
 *  speaker/earpiece routing. */
class BackchannelAudioPlayer {
    private companion object {
        const val TAG = "BackchannelPlayer"
        const val SAMPLE_RATE = 24_000
    }

    private var track: AudioTrack? = null

    // Single thread keeps chunk order; AudioTrack.write blocks, so keep it off main.
    private val writeDispatcher = Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val writeScope = CoroutineScope(SupervisorJob() + writeDispatcher)

    @OptIn(ExperimentalEncodingApi::class)
    fun enqueue(base64Pcm16: String) {
        writeScope.launch {
            val bytes = runCatching { Base64.decode(base64Pcm16) }.getOrNull()
            if (bytes == null || bytes.isEmpty()) {
                Log.e(TAG, "back-channel chunk failed base64 decode")
                return@launch
            }
            val track = ensureTrack() ?: return@launch
            track.write(bytes, 0, bytes.size, AudioTrack.WRITE_BLOCKING)
        }
    }

    fun stop() {
        writeScope.cancel()
        writeDispatcher.close()
        track?.run {
            runCatching { pause() }
            runCatching { flush() }
            runCatching { release() }
        }
        track = null
    }

    private fun ensureTrack(): AudioTrack? {
        track?.let { return it }
        return runCatching {
            AudioTrack.Builder()
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                .setAudioFormat(
                    AudioFormat.Builder()
                        .setSampleRate(SAMPLE_RATE)
                        .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                        .build(),
                )
                .setTransferMode(AudioTrack.MODE_STREAM)
                .setBufferSizeInBytes(
                    maxOf(
                        AudioTrack.getMinBufferSize(
                            SAMPLE_RATE,
                            AudioFormat.CHANNEL_OUT_MONO,
                            AudioFormat.ENCODING_PCM_16BIT,
                        ),
                        SAMPLE_RATE, // ~500ms of 16-bit mono
                    ),
                )
                .build()
                .also {
                    it.play()
                    track = it
                }
        }.onFailure { Log.e(TAG, "AudioTrack failed to start", it) }.getOrNull()
    }
}
