const { io } = require('socket.io-client');
const { EventEmitter } = require('events');

class SocketManager extends EventEmitter {
  constructor(obsManager) {
    super();
    this.obsManager = obsManager;
    this.socket = null;
    this.connId = null;
    this.token = null;
    this.lastError = null;

    obsManager.on('obs-status', (data) => {
      this._sendStatus(data);
    });
    obsManager.on('obs-event', (data) => {
      this._sendEvent(data);
    });
  }

  connect({ serverUrl, token }) {
    this.token = token;
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.connId = null;
    this.emit('status');

    this.socket = io(serverUrl, {
      transports: ['websocket'],
      reconnectionAttempts: Infinity
    });

    this.socket.on('connect', () => {
      this.emit('status');
      this.socket.emit('agent-auth', { token });
    });

    this.socket.on('agent-auth-result', (data) => {
      if (!data.ok) {
        this.connId = null;
        this.lastError = data.error;
        this.emit('status');
        return;
      }
      this.connId = data.connId;
      this.lastError = null;
      this.emit('status');
      this.emit('registered', data.connId);
    });

    this.socket.on('agent-obs-command', async (data) => {
      const { command, scene } = data;
      try {
        let result;
        switch (command) {
          case 'connect':
            result = { success: true };
            break;
          case 'disconnect':
            await this.obsManager.disconnect();
            result = { success: true };
            break;
          case 'switchScene':
            await this.obsManager.changeScene(scene);
            result = { success: true, scene };
            break;
          case 'startStream':
            await this.obsManager.startStream();
            result = { success: true };
            break;
          case 'stopStream':
            await this.obsManager.stopStream();
            result = { success: true };
            break;
          case 'startRecording':
            await this.obsManager.startRecording();
            result = { success: true };
            break;
          case 'stopRecording':
            await this.obsManager.stopRecording();
            result = { success: true };
            break;
          default:
            result = { success: false, error: `Unknown command: ${command}` };
        }
        this.socket.emit('agent-obs-result', { connId: this.connId, command, ...result });
      } catch (err) {
        this.socket.emit('agent-obs-result', { connId: this.connId, command, success: false, error: err.message });
      }
    });

    this.socket.on('disconnect', () => {
      this.emit('status');
    });
  }

  _sendStatus(data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('agent-obs-status', { connId: this.connId, ...data });
    }
  }

  _sendEvent(data) {
    if (this.socket && this.socket.connected) {
      this.socket.emit('agent-obs-event', { connId: this.connId, event: data.event, data: data.data });
    }
  }

  isConnected() {
    return !!(this.socket && this.socket.connected);
  }

  isRegistered() {
    return !!this.connId;
  }

  getStatus() {
    return {
      serverConnected: this.isConnected(),
      registered: this.isRegistered(),
      lastError: this.lastError
    };
  }
}

module.exports = SocketManager;
