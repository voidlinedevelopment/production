const $ = (id) => document.getElementById(id);

function setBadge(el, text, kind) {
  el.textContent = text;
  el.className = `badge ${kind}`;
}

function setStatus(s) {
  const server = $('server-status');
  server.textContent = s.serverConnected ? 'Connected' : 'Disconnected';
  server.className = `row-value ${s.serverConnected ? 'text-ok' : ''}`;

  const agent = $('agent-status');
  const agentKind = s.registered ? 'badge-ok' : s.lastError ? 'badge-err' : 'badge-dim';
  agent.textContent = s.registered ? 'Registered' : s.lastError ? `Error: ${s.lastError}` : 'Not registered';
  agent.className = `subtitle badge ${agentKind}`;

  const obs = $('obs-status');
  obs.textContent = s.obsConnected ? 'Connected' : s.obsError ? 'Error' : 'Disconnected';
  obs.className = `row-value ${s.obsConnected ? 'text-ok' : s.obsError ? 'text-err' : ''}`;

  const errWrap = $('obs-error-wrap');
  if (s.obsError) {
    $('obs-error').textContent = s.obsError;
    errWrap.style.display = 'block';
  } else {
    errWrap.style.display = 'none';
  }

  $('scene').textContent = s.currentScene || '--';
  $('scene-count').textContent = s.scenes ? s.scenes.length : '--';
  $('stream').textContent = s.streaming ? 'LIVE' : 'Not Streaming';
  $('stream').style.color = s.streaming ? '#f85149' : '';
  $('recording').textContent = s.recording ? 'Recording' : 'No';
  $('recording').style.color = s.recording ? '#f85149' : '';

  if (s.version) $('version').textContent = s.version;
}

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await window.api.getSettings();
  $('token').value = settings.token || '';
  $('obsPort').value = settings.obsPort || 4455;
  $('obsPassword').value = settings.obsPassword || '';
  $('startup').checked = await window.api.getStartup();

  $('startup').addEventListener('change', (e) => {
    window.api.setStartup(e.target.checked);
  });

  $('save-btn').addEventListener('click', async () => {
    $('save-btn').disabled = true;
    await window.api.saveSettings({
      token: $('token').value.trim(),
      obsPort: $('obsPort').value,
      obsPassword: $('obsPassword').value
    });
    $('save-btn').disabled = false;
    $('save-btn').textContent = 'Saved';
    setTimeout(() => {
      $('save-btn').textContent = 'Save & Connect';
    }, 1500);
  });

  $('update-btn').addEventListener('click', () => {
    window.api.installUpdate();
  });

  $('check-update-btn').addEventListener('click', () => {
    $('check-update-btn').disabled = true;
    window.api.checkForUpdates();
    setTimeout(() => { $('check-update-btn').disabled = false; }, 1500);
  });

  window.api.onStatus(setStatus);
  window.api.onUpdateDownloaded(() => {
    $('update-banner').style.display = 'block';
  });

  window.api.onUpdateStatus((s) => {
    const el = $('update-status');
    switch (s.phase) {
      case 'checking':
        el.textContent = 'Checking for updates...';
        el.style.color = '#8b949e';
        break;
      case 'available':
        el.textContent = `Update ${s.version} found - downloading...`;
        el.style.color = '#3fb950';
        break;
      case 'downloading':
        el.textContent = `Downloading... ${s.percent}%`;
        el.style.color = '#3fb950';
        break;
      case 'downloaded':
        el.textContent = `Update ${s.version} downloaded. Click "Restart & Update".`;
        el.style.color = '#3fb950';
        break;
      case 'not-available':
        el.textContent = 'You have the latest version.';
        el.style.color = '#8b949e';
        break;
      case 'error':
        el.textContent = 'Update check failed: ' + (s.message || 'unknown error');
        el.style.color = '#f85149';
        break;
    }
  });

  window.api.onPreviewCommand((enabled) => {
    if (enabled) startLivePreview();
    else stopLivePreview();
  });
});

let previewStream = null;
let previewRecorder = null;
let previewStreamId = 0;

async function findObsVirtualCam() {
  try {
    const warm = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    warm.getTracks().forEach((t) => t.stop());
  } catch (e) {}
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cam = devices.find((d) => d.kind === 'videoinput' && /obs virtual camera/i.test(d.label));
      if (cam) return cam.deviceId;
    } catch (e) {}
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

function stopLivePreview() {
  if (previewRecorder) {
    try { previewRecorder.stop(); } catch (e) {}
    previewRecorder = null;
  }
  if (previewStream) {
    previewStream.getTracks().forEach((t) => t.stop());
    previewStream = null;
  }
}

async function startLivePreview() {
  stopLivePreview();
  const streamId = ++previewStreamId;

  const deviceId = await findObsVirtualCam();
  if (!deviceId) {
    window.api.previewLiveFailed('OBS Virtual Camera not found. Enable it in OBS (Tools -> Virtual Camera).');
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        deviceId: { exact: deviceId },
        width: { ideal: 640 },
        height: { ideal: 360 },
        frameRate: { ideal: 15 }
      },
      audio: false
    });
    if (streamId !== previewStreamId) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    previewStream = stream;

    const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp8')
      ? 'video/webm;codecs=vp8'
      : MediaRecorder.isTypeSupported('video/webm')
        ? 'video/webm'
        : null;
    if (!mime) {
      window.api.previewLiveFailed('MediaRecorder not supported in this build.');
      return;
    }

    previewRecorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 900000 });
    previewRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        e.data.arrayBuffer().then((buf) => {
          window.api.sendPreviewChunk(streamId, buf);
        });
      }
    };
    previewRecorder.onerror = (e) => {
      window.api.previewLiveFailed('Live preview failed: ' + (e.error || 'unknown'));
    };
    previewRecorder.start(1000);
    window.api.previewLiveOk();
  } catch (err) {
    window.api.previewLiveFailed('Could not start live preview: ' + err.message);
  }
}
