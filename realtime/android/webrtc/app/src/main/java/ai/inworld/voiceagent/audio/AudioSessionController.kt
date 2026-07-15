package ai.inworld.voiceagent.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceInfo
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.audiofx.AcousticEchoCanceler
import android.os.Build

/** Owns the AudioManager voice-call configuration — the Android analog of the iOS
 *  RTCAudioSessionConfiguration template. */
class AudioSessionController(context: Context) {
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private var focusRequest: AudioFocusRequest? = null

    fun configure(config: AudioDebugConfig) {
        audioManager.mode = when (config.mode) {
            AudioMode.InCommunication -> AudioManager.MODE_IN_COMMUNICATION
            AudioMode.Normal -> AudioManager.MODE_NORMAL
        }
        val attributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
            .setAudioAttributes(attributes)
            .build()
        audioManager.requestAudioFocus(request)
        focusRequest = request
    }

    fun overrideToSpeaker() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.availableCommunicationDevices
                .firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_SPEAKER }
                ?.let(audioManager::setCommunicationDevice)
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = true
        }
    }

    fun deactivate() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            audioManager.clearCommunicationDevice()
        } else {
            @Suppress("DEPRECATION")
            audioManager.isSpeakerphoneOn = false
        }
        focusRequest?.let(audioManager::abandonAudioFocusRequest)
        focusRequest = null
        audioManager.mode = AudioManager.MODE_NORMAL
    }

    /** Live, ground-truth read of what Android actually applied — confirms a debug
     *  toggle took effect. */
    fun liveDescription(hwAecRequested: Boolean): String {
        val mode = when (audioManager.mode) {
            AudioManager.MODE_IN_COMMUNICATION -> "IN_COMMUNICATION"
            AudioManager.MODE_NORMAL -> "NORMAL"
            AudioManager.MODE_IN_CALL -> "IN_CALL"
            else -> "mode=${audioManager.mode}"
        }
        val device = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            when (audioManager.communicationDevice?.type) {
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> "speaker"
                AudioDeviceInfo.TYPE_BUILTIN_EARPIECE -> "earpiece"
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "bluetooth"
                AudioDeviceInfo.TYPE_WIRED_HEADSET, AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> "wired"
                null -> "default"
                else -> "type=${audioManager.communicationDevice?.type}"
            }
        } else {
            @Suppress("DEPRECATION")
            if (audioManager.isSpeakerphoneOn) "speaker" else "default"
        }
        val hwAec = "HW AEC ${if (hwAecRequested && AcousticEchoCanceler.isAvailable()) "ON" else "OFF"}"
        return "$mode · $device · $hwAec"
    }
}
