// Utility Functions

// Generate unique session ID
export function generateSessionId() {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Update status bar (removed - no longer used)
export function updateStatus(message, type = 'info') {
    // Status bar functionality removed - no logging needed
}
