package ai.inworld.voiceagent.ui

import ai.inworld.voiceagent.AppContainer
import ai.inworld.voiceagent.state.CatalogViewModel
import ai.inworld.voiceagent.state.ConversationViewModel
import androidx.compose.runtime.Composable
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import kotlinx.serialization.Serializable

@Serializable
data object ConversationRoute

@Serializable
data object SettingsRoute

@Composable
fun AppNavHost(container: AppContainer) {
    val navController = rememberNavController()
    val conversationViewModel: ConversationViewModel = viewModel(
        factory = viewModelFactory {
            initializer { ConversationViewModel(sessionFactory = container::makeSession) }
        },
    )
    val catalogViewModel: CatalogViewModel = viewModel(
        factory = viewModelFactory {
            initializer { CatalogViewModel(container.settingsRepository) }
        },
    )

    NavHost(navController = navController, startDestination = ConversationRoute) {
        composable<ConversationRoute> {
            ConversationScreen(
                viewModel = conversationViewModel,
                settingsRepository = container.settingsRepository,
                liveAudioDescription = { container.audioSession.liveDescription(hwAecRequested = it) },
                onOpenSettings = { navController.navigate(SettingsRoute) },
            )
        }
        composable<SettingsRoute> {
            SettingsScreen(
                settingsRepository = container.settingsRepository,
                catalogViewModel = catalogViewModel,
                liveAudioDescription = { container.audioSession.liveDescription(hwAecRequested = it) },
                onBack = { navController.popBackStack() },
            )
        }
    }
}
