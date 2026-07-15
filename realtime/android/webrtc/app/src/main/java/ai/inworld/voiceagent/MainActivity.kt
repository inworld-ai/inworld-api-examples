package ai.inworld.voiceagent

import ai.inworld.voiceagent.ui.AppNavHost
import ai.inworld.voiceagent.ui.theme.AppTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import android.media.AudioManager

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        // Session audio plays on the voice-call stream (USAGE_VOICE_COMMUNICATION);
        // make the hardware volume keys target it instead of media volume.
        volumeControlStream = AudioManager.STREAM_VOICE_CALL
        setContent {
            AppTheme {
                AppNavHost((application as App).container)
            }
        }
    }
}
