package ai.inworld.voiceagent.ui

import ai.inworld.voiceagent.state.CatalogViewModel
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ModelPickerSheet(
    catalogViewModel: CatalogViewModel,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    LaunchedEffect(Unit) { catalogViewModel.loadModels() }
    val state by catalogViewModel.uiState.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.padding(16.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search models") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.isLoadingModels) {
                CircularProgressIndicator(modifier = Modifier.padding(24.dp))
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            LazyColumn {
                val filtered = state.models.filter {
                    query.isEmpty() || it.realtimeIdentifier.contains(query, ignoreCase = true)
                }
                items(filtered, key = { it.realtimeIdentifier }) { model ->
                    ListItem(
                        headlineContent = { Text(model.realtimeIdentifier) },
                        supportingContent = model.modelCreator?.let { { Text(it) } },
                        modifier = Modifier.clickable { onSelect(model.realtimeIdentifier) },
                    )
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun VoicePickerSheet(
    catalogViewModel: CatalogViewModel,
    onSelect: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    LaunchedEffect(Unit) { catalogViewModel.loadVoices() }
    val state by catalogViewModel.uiState.collectAsStateWithLifecycle()
    var query by remember { mutableStateOf("") }

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(modifier = Modifier.padding(16.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                label = { Text("Search voices") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            if (state.isLoadingVoices) {
                CircularProgressIndicator(modifier = Modifier.padding(24.dp))
            }
            state.error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            LazyColumn {
                val filtered = state.voices.filter { voice ->
                    query.isEmpty() ||
                        (voice.displayName ?: voice.voiceId).contains(query, ignoreCase = true) ||
                        voice.langCode?.contains(query, ignoreCase = true) == true
                }
                items(filtered, key = { it.voiceId }) { voice ->
                    ListItem(
                        headlineContent = { Text(voice.displayName ?: voice.voiceId) },
                        supportingContent = {
                            Text(listOfNotNull(voice.langCode, voice.gender).joinToString(" · "))
                        },
                        modifier = Modifier.clickable { onSelect(voice.voiceId) },
                    )
                }
            }
        }
    }
}
