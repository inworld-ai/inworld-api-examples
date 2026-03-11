/**
 * Session Manager
 * Handles active TTS sessions and SSE client connections
 */

class SessionManager {
    constructor() {
        this.activeSessions = new Map();
    }

    /**
     * Get or create a session
     * @param {string} sessionId - The session ID
     * @returns {Object} Session object
     */
    getOrCreateSession(sessionId) {
        if (!this.activeSessions.has(sessionId)) {
            this.activeSessions.set(sessionId, { clients: [] });
        }
        return this.activeSessions.get(sessionId);
    }

    /**
     * Add a client to a session
     * @param {string} sessionId - The session ID
     * @param {Object} client - The SSE response object
     */
    addClient(sessionId, client) {
        const session = this.getOrCreateSession(sessionId);
        session.clients.push(client);
    }

    /**
     * Remove a client from a session
     * @param {string} sessionId - The session ID
     * @param {Object} client - The SSE response object to remove
     */
    removeClient(sessionId, client) {
        const session = this.activeSessions.get(sessionId);
        if (session) {
            session.clients = session.clients.filter(c => c !== client);
            if (session.clients.length === 0) {
                this.activeSessions.delete(sessionId);
            }
        }
    }

    /**
     * Send update to all clients in a session
     * @param {string} sessionId - The session ID
     * @param {Object} data - The data to send
     */
    sendUpdate(sessionId, data) {
        const session = this.activeSessions.get(sessionId);
        console.log(`[SessionManager] Sending to session ${sessionId}:`, data.type, `(${session ? session.clients.length : 0} clients)`);
        
        if (session && session.clients.length > 0) {
            const message = `data: ${JSON.stringify(data)}\n\n`;
            session.clients.forEach((client, index) => {
                try {
                    client.write(message);
                    console.log(`[SessionManager] Message sent to client ${index}`);
                } catch (error) {
                    console.error(`[SessionManager] Error sending to client ${index}:`, error);
                }
            });
        } else {
            console.warn(`[SessionManager] No session or clients found for ${sessionId}`);
        }
    }

    /**
     * Check if session exists
     * @param {string} sessionId - The session ID
     * @returns {boolean} True if session exists
     */
    hasSession(sessionId) {
        return this.activeSessions.has(sessionId);
    }

    /**
     * Get session client count
     * @param {string} sessionId - The session ID
     * @returns {number} Number of clients in session
     */
    getClientCount(sessionId) {
        const session = this.activeSessions.get(sessionId);
        return session ? session.clients.length : 0;
    }
}

export default SessionManager;
