package ai.inworld.voiceagent

import ai.inworld.voiceagent.ui.AppNavHost
import ai.inworld.voiceagent.ui.theme.AppTheme
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            AppTheme {
                AppNavHost((application as App).container)
            }
        }
    }
}
