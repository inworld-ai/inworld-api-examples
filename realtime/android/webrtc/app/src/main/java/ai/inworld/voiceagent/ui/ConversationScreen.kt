package ai.inworld.voiceagent.ui

import ai.inworld.voiceagent.state.ConversationViewModel
import ai.inworld.voiceagent.storage.Settings
import ai.inworld.voiceagent.storage.SettingsRepository
import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import androidx.compose.runtime.rememberCoroutineScope

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ConversationScreen(
    viewModel: ConversationViewModel,
    settingsRepository: SettingsRepository,
    liveAudioDescription: (Boolean) -> String,
    onOpenSettings: () -> Unit,
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val settings by settingsRepository.settings.collectAsStateWithLifecycle(initialValue = Settings())
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission(),
    ) { granted ->
        if (granted) {
            scope.launch { viewModel.connect(settingsRepository.current()) }
        }
    }

    fun connectWithPermission() {
        val granted = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
            scope.launch { viewModel.connect(settingsRepository.current()) }
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(
                title = { Text("Inworld Voice") },
                actions = {
                    IconButton(onClick = onOpenSettings) { Text("⚙️") }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            val listState = rememberLazyListState()
            LaunchedEffect(uiState.transcript.lastOrNull()?.let { it.id to it.text.length }) {
                if (uiState.transcript.isNotEmpty()) {
                    listState.scrollToItem(uiState.transcript.lastIndex)
                }
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                if (uiState.transcript.isEmpty()) {
                    item { EmptyState(isConnected = uiState.isConnected) }
                }
                items(uiState.transcript, key = { it.id }) { item ->
                    MessageBubble(item)
                }
            }
            HorizontalDivider()
            ConnectionControls(
                state = uiState,
                liveAudioDescription = if (uiState.isConnected) {
                    liveAudioDescription(settings.useHardwareAec)
                } else null,
                onConnect = ::connectWithPermission,
                onDisconnect = viewModel::disconnect,
                onMicMutedChange = viewModel::setMicMuted,
            )
        }
    }
}

@Composable
private fun EmptyState(isConnected: Boolean) {
    Column(
        modifier = Modifier.fillMaxWidth().padding(top = 80.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("🎧", style = MaterialTheme.typography.displayMedium)
        Text(
            text = if (isConnected) "Listening — just start talking."
            else "Connect to start a voice conversation.",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(top = 8.dp),
        )
    }
}
