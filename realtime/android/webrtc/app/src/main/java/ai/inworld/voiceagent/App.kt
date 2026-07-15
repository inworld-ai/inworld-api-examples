package ai.inworld.voiceagent

import ai.inworld.voiceagent.audio.AudioSessionController
import ai.inworld.voiceagent.realtime.RealtimeSession
import ai.inworld.voiceagent.realtime.RealtimeSessionApi
import ai.inworld.voiceagent.storage.Settings
import ai.inworld.voiceagent.storage.SettingsRepository
import android.app.Application
import kotlinx.coroutines.CoroutineScope

class App : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

/** Manual DI root — kept deliberately simple for a demo (no Hilt). */
class AppContainer(private val app: Application) {
    val settingsRepository by lazy { SettingsRepository(app) }
    val audioSession by lazy { AudioSessionController(app) }

    fun makeSession(settings: Settings, scope: CoroutineScope): RealtimeSessionApi = RealtimeSession(
        context = app,
        authProvider = settings.makeAuthProvider(),
        config = settings.makeSessionConfig(),
        audioDebug = settings.makeAudioDebugConfig(),
        scope = scope,
    )
}
