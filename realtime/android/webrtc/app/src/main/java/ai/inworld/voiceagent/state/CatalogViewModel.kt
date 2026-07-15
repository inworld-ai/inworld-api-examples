package ai.inworld.voiceagent.state

import ai.inworld.voiceagent.realtime.CatalogApi
import ai.inworld.voiceagent.realtime.LlmModelInfo
import ai.inworld.voiceagent.realtime.VoiceInfo
import ai.inworld.voiceagent.storage.SettingsRepository
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class CatalogUiState(
    val models: List<LlmModelInfo> = emptyList(),
    val voices: List<VoiceInfo> = emptyList(),
    val isLoadingModels: Boolean = false,
    val isLoadingVoices: Boolean = false,
    val error: String? = null,
)

class CatalogViewModel(private val settingsRepository: SettingsRepository) : ViewModel() {
    private val _uiState = MutableStateFlow(CatalogUiState())
    val uiState: StateFlow<CatalogUiState> = _uiState

    fun loadModels(force: Boolean = false) {
        if (!force && (_uiState.value.models.isNotEmpty() || _uiState.value.isLoadingModels)) return
        _uiState.update { it.copy(isLoadingModels = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val credentials = settingsRepository.current().makeAuthProvider().credentials()
                CatalogApi(credentials).fetchModels()
            }.onSuccess { models ->
                _uiState.update { it.copy(models = models, isLoadingModels = false) }
            }.onFailure { e ->
                _uiState.update { it.copy(isLoadingModels = false, error = e.message) }
            }
        }
    }

    fun loadVoices(force: Boolean = false) {
        if (!force && (_uiState.value.voices.isNotEmpty() || _uiState.value.isLoadingVoices)) return
        _uiState.update { it.copy(isLoadingVoices = true, error = null) }
        viewModelScope.launch {
            runCatching {
                val credentials = settingsRepository.current().makeAuthProvider().credentials()
                CatalogApi(credentials).fetchVoices()
            }.onSuccess { voices ->
                _uiState.update { it.copy(voices = voices, isLoadingVoices = false) }
            }.onFailure { e ->
                _uiState.update { it.copy(isLoadingVoices = false, error = e.message) }
            }
        }
    }
}
