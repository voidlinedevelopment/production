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

  window.api.onStatus(setStatus);
  window.api.onUpdateDownloaded(() => {
    $('update-banner').style.display = 'block';
  });
});
