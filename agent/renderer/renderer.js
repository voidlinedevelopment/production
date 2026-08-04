const $ = (id) => document.getElementById(id);

function setStatus(s) {
  const server = $('server-status');
  server.textContent = s.serverConnected ? 'Connected' : 'Disconnected';
  server.className = `text-sm font-medium ${s.serverConnected ? 'text-green-400' : 'text-surface-500'}`;

  const agent = $('agent-status');
  agent.textContent = s.registered ? 'Registered' : s.lastError ? `Error: ${s.lastError}` : 'Not registered';
  agent.className = `text-xs ${s.registered ? 'text-green-400' : 'text-surface-500'}`;

  const obs = $('obs-status');
  obs.textContent = s.obsConnected ? 'Connected' : s.obsError ? 'Error' : 'Disconnected';
  obs.className = `text-sm font-medium ${s.obsConnected ? 'text-green-400' : s.obsError ? 'text-red-400' : 'text-surface-500'}`;

  const errWrap = $('obs-error-wrap');
  if (s.obsError) {
    $('obs-error').textContent = s.obsError;
    errWrap.classList.remove('hidden');
  } else {
    errWrap.classList.add('hidden');
  }

  $('scene').textContent = s.currentScene || '--';
  $('scene-count').textContent = s.scenes ? s.scenes.length : '--';
  $('stream').textContent = s.streaming ? 'LIVE' : 'Not Streaming';
  $('stream').className = `font-semibold text-sm ${s.streaming ? 'text-red-400' : ''}`;
  $('recording').textContent = s.recording ? 'Recording' : 'No';
  $('recording').className = `font-semibold text-sm ${s.recording ? 'text-red-400' : ''}`;
}

window.addEventListener('DOMContentLoaded', async () => {
  const settings = await window.api.getSettings();
  $('token').value = settings.token || '';
  $('obsHost').value = settings.obsHost || '127.0.0.1';
  $('obsPort').value = settings.obsPort || 4455;
  $('obsPassword').value = settings.obsPassword || '';

  $('save-btn').addEventListener('click', async () => {
    $('save-btn').disabled = true;
    const saved = await window.api.saveSettings({
      token: $('token').value.trim(),
      obsHost: $('obsHost').value.trim(),
      obsPort: $('obsPort').value,
      obsPassword: $('obsPassword').value
    });
    $('save-btn').disabled = false;
    if (saved) {
      $('save-btn').innerHTML = '<i class="fas fa-check mr-2"></i>Saved';
      setTimeout(() => {
        $('save-btn').innerHTML = '<i class="fas fa-plug mr-2"></i>Save &amp; Connect';
      }, 1500);
    }
  });

  window.api.onStatus(setStatus);
});
