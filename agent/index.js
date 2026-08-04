require('dotenv').config();
const { io } = require('socket.io-client');
const OBSWebSocket = require('obs-websocket-js').default;

const SERVER_URL = process.env.SERVER_URL || 'http://localhost:3000';
const AGENT_TOKEN = process.env.AGENT_TOKEN;
const OBS_HOST = process.env.OBS_HOST || '127.0.0.1';
const OBS_PORT = parseInt(process.env.OBS_PORT || '4455', 10);
const OBS_PASSWORD = process.env.OBS_PASSWORD || '';

if (!AGENT_TOKEN) {
  console.error('AGENT_TOKEN is required. Copy it from your Production OBS Connections page.');
  process.exit(1);
}

const socket = io(SERVER_URL, {
  transports: ['websocket'],
  reconnectionAttempts: Infinity
});

let obs = null;
let connId = null;
let reconnectTimer = null;

function createObsClient() {
  obs = new OBSWebSocket();
  obs.on('ConnectionClosed', () => {
    console.log('OBS connection closed.');
    socket.emit('agent-obs-status', { connId, connected: false });
    scheduleReconnect();
  });
  obs.on('CurrentProgramSceneChanged', (data) => {
    socket.emit('agent-obs-event', { connId, event: 'CurrentProgramSceneChanged', data: { sceneName: data.sceneName } });
  });
  obs.on('StreamStateChanged', (data) => {
    socket.emit('agent-obs-event', { connId, event: 'StreamStateChanged', data: { outputActive: data.outputActive } });
  });
  obs.on('RecordStateChanged', (data) => {
    socket.emit('agent-obs-event', { connId, event: 'RecordStateChanged', data: { outputActive: data.outputActive } });
  });
}

async function connectOBS() {
  if (obs && obs.connected) return;
  try {
    createObsClient();
    await obs.connect(`ws://${OBS_HOST}:${OBS_PORT}`, OBS_PASSWORD || undefined);
    console.log('Connected to OBS.');

    const status = await obs.call('GetStreamStatus');
    const sceneList = await obs.call('GetSceneList');
    let recordStatus = { outputActive: false };
    let stats = null;
    try {
      recordStatus = await obs.call('GetRecordStatus');
      stats = await obs.call('GetStats');
    } catch (e) {}

    const info = {
      streaming: status.outputActive,
      recording: recordStatus.outputActive,
      currentScene: sceneList.currentProgramSceneName,
      scenes: sceneList.scenes.map((s) => s.sceneName),
      fps: stats ? stats.activeFps : 0
    };

    socket.emit('agent-obs-status', { connId, connected: true, info });
    reconnectTimer = null;
  } catch (err) {
    console.error('OBS connect failed:', err.message);
    socket.emit('agent-obs-status', { connId, connected: false, error: err.message });
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectOBS();
  }, 5000);
}

socket.on('connect', () => {
  console.log(`Connected to Production server: ${SERVER_URL}`);
  socket.emit('agent-auth', { token: AGENT_TOKEN });
});

socket.on('agent-auth-result', (data) => {
  if (!data.ok) {
    console.error('Auth failed:', data.error);
    socket.disconnect();
    process.exit(1);
  }
  connId = data.connId;
  console.log(`Registered as agent for OBS connection #${connId} (${data.name || 'unnamed'})`);
  connectOBS();
});

socket.on('agent-obs-command', async (data) => {
  const { command, scene } = data;
  try {
    let result;
    switch (command) {
      case 'connect':
        await connectOBS();
        result = { success: true };
        break;
      case 'disconnect':
        if (obs) await obs.disconnect();
        result = { success: true };
        break;
      case 'switchScene':
        await obs.call('SetCurrentProgramScene', { sceneName: scene });
        result = { success: true };
        break;
      case 'startStream':
        await obs.call('StartStream');
        result = { success: true };
        break;
      case 'stopStream':
        await obs.call('StopStream');
        result = { success: true };
        break;
      case 'startRecording':
        await obs.call('StartRecord');
        result = { success: true };
        break;
      case 'stopRecording':
        await obs.call('StopRecord');
        result = { success: true };
        break;
      default:
        result = { success: false, error: `Unknown command: ${command}` };
    }
    socket.emit('agent-obs-result', { connId, command, ...result });
  } catch (err) {
    socket.emit('agent-obs-result', { connId, command, success: false, error: err.message });
  }
});

socket.on('disconnect', () => {
  console.log('Disconnected from Production server. Reconnecting...');
});
