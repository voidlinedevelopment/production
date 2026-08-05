const { getAll, getOne, getTeamPlan } = require('../../shared/database');
const { getPlan, limit, exceedsLimit, PLAN_ORDER, hasFlag } = require('../../shared/plans');

const ENFORCE_PLANS = process.env.ENFORCE_PLANS === 'true';
const BILLING_URL = process.env.BILLING_URL || '';

async function isAdmin(userId) {
  if (!userId) return false;
  const user = await getOne('SELECT is_admin FROM users WHERE id = ?', [userId]);
  return !!(user && user.is_admin);
}

async function teamPlan(teamId) {
  const team = await getOne('SELECT owner_id FROM teams WHERE id = ?', [teamId]);
  if (team && (await isAdmin(team.owner_id))) return 'studio';
  return getTeamPlan(teamId);
}

async function teamFlag(teamId, flag) {
  const planKey = await teamPlan(teamId);
  return { ok: !ENFORCE_PLANS || hasFlag(planKey, flag), planKey, plan: getPlan(planKey) };
}

async function getUserPlan(userId) {
  if (await isAdmin(userId)) return 'studio';
  const rows = await getAll(
    `SELECT s.plan FROM subscriptions s
     JOIN teams t ON t.id = s.team_id
     WHERE t.owner_id = ? AND s.status IN ('active', 'trialing')`,
    [userId]
  );
  let best = 'free';
  for (const row of rows) {
    if (PLAN_ORDER.indexOf(row.plan) > PLAN_ORDER.indexOf(best)) best = row.plan;
  }
  return best;
}

async function checkLimit(teamId, resource, current) {
  const planKey = await teamPlan(teamId);
  const plan = getPlan(planKey);
  if (!ENFORCE_PLANS) return { ok: true, planKey, plan, limit: Infinity };
  const max = limit(planKey, resource);
  return { ok: !exceedsLimit(planKey, resource, current), planKey, plan, limit: max };
}

async function checkUserLimit(userId, resource, current) {
  const planKey = await getUserPlan(userId);
  const plan = getPlan(planKey);
  if (!ENFORCE_PLANS) return { ok: true, planKey, plan, limit: Infinity };
  const max = limit(planKey, resource);
  return { ok: !exceedsLimit(planKey, resource, current), planKey, plan, limit: max };
}

module.exports = {
  ENFORCE_PLANS,
  BILLING_URL,
  isAdmin,
  teamPlan,
  teamFlag,
  getUserPlan,
  checkLimit,
  checkUserLimit
};
