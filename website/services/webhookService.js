const crypto = require('crypto');
const { getAll } = require('../../shared/database');

const SUPPORTED_EVENTS = [
  'production.live',
  'production.completed',
  'production.draft',
  'obs.connected',
  'obs.disconnected',
  'obs.scene_changed',
  'obs.stream_started',
  'obs.stream_stopped',
  'obs.recording_started',
  'obs.recording_stopped',
  'team.member_joined',
  'team.member_removed'
];

function signPayload(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

async function deliverWebhooks(teamId, event, payload) {
  const webhooks = await getAll(
    'SELECT * FROM webhooks WHERE team_id = ? AND active = 1',
    [teamId]
  );
  const body = JSON.stringify({
    event,
    teamId: String(teamId),
    data: payload || {},
    timestamp: new Date().toISOString()
  });

  for (const hook of webhooks) {
    let events;
    try {
      events = JSON.parse(hook.events || '[]');
    } catch (e) {
      events = [];
    }
    if (!events.includes(event)) continue;

    const headers = { 'Content-Type': 'application/json' };
    if (hook.secret) headers['X-Production-Signature'] = signPayload(hook.secret, body);

    fetch(hook.url, { method: 'POST', headers, body })
      .catch((err) => console.error(`[webhook] delivery failed for hook ${hook.id}: ${err.message}`));
  }
}

module.exports = { SUPPORTED_EVENTS, signPayload, deliverWebhooks };
