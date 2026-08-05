const PLAN_ORDER = ['free', 'creator', 'studio', 'enterprise'];

const PLANS = {
  free: {
    key: 'free',
    name: 'Free',
    price: 0,
    priceLabel: '$0',
    blurb: 'Solo users trying Production',
    priceId: () => null,
    limits: { teams: 1, members: 3, obsConnections: 1 },
    features: [
      '1 team',
      '3 members',
      '1 OBS connection',
      'Basic OBS controls',
      'Production scheduling',
      'Discord login',
      'Community support'
    ],
    flags: {}
  },

  creator: {
    key: 'creator',
    name: 'Creator',
    price: 9.99,
    priceLabel: '$9.99',
    blurb: 'Small streamers',
    priceId: () => process.env.STRIPE_PRICE_CREATOR || null,
    limits: { teams: 1, members: 10, obsConnections: 3 },
    features: [
      'Everything in Free, plus:',
      'Up to 10 team members',
      '3 OBS connections',
      'Unlimited productions',
      'Custom team logo',
      'Production analytics',
      'Overlay presets',
      'Discord notifications',
      'Agent auto reconnect',
      'Priority support'
    ],
    flags: {
      customLogo: true,
      analytics: true,
      overlayPresets: true,
      discordNotifications: true,
      agentAutoReconnect: true,
      prioritySupport: true
    }
  },

  studio: {
    key: 'studio',
    name: 'Studio',
    price: 24.99,
    priceLabel: '$24.99',
    blurb: 'Production teams',
    priceId: () => process.env.STRIPE_PRICE_STUDIO || null,
    limits: { teams: Infinity, members: Infinity, obsConnections: Infinity },
    features: [
      'Everything in Creator, plus:',
      'Unlimited members',
      'Unlimited OBS connections',
      'Unlimited teams',
      'Role permission templates',
      'Scene presets',
      'Production templates',
      'Advanced scheduling',
      'Shared rundowns',
      'Production history',
      'Activity logs',
      'Team audit logs',
      'Priority queue',
      'Faster live preview',
      'API access',
      'Webhooks',
      'Custom branding',
      'Early access features'
    ],
    flags: {
      customLogo: true,
      analytics: true,
      overlayPresets: true,
      discordNotifications: true,
      agentAutoReconnect: true,
      prioritySupport: true,
      unlimitedTeams: true,
      unlimitedMembers: true,
      unlimitedObs: true,
      roleTemplates: true,
      scenePresets: true,
      productionTemplates: true,
      advancedScheduling: true,
      sharedRundowns: true,
      productionHistory: true,
      activityLogs: true,
      auditLogs: true,
      priorityQueue: true,
      fasterPreview: true,
      apiAccess: true,
      webhooks: true,
      customBranding: true,
      earlyAccess: true
    }
  },

  enterprise: {
    key: 'enterprise',
    name: 'Enterprise',
    price: 79.99,
    priceLabel: '$79.99',
    blurb: 'Esports orgs & businesses',
    priceId: () => process.env.STRIPE_PRICE_ENTERPRISE || null,
    limits: { teams: Infinity, members: Infinity, obsConnections: Infinity },
    features: [
      'Everything in Studio, plus:',
      'Unlimited everything',
      'Multiple organizations',
      'Dedicated support',
      'Custom integrations',
      'SLA uptime guarantee',
      'White-label dashboard',
      'Custom domain',
      'Account manager',
      'Beta features',
      'Team onboarding',
      'Advanced security logs'
    ],
    flags: {
      customLogo: true,
      analytics: true,
      overlayPresets: true,
      discordNotifications: true,
      agentAutoReconnect: true,
      prioritySupport: true,
      unlimitedTeams: true,
      unlimitedMembers: true,
      unlimitedObs: true,
      roleTemplates: true,
      scenePresets: true,
      productionTemplates: true,
      advancedScheduling: true,
      sharedRundowns: true,
      productionHistory: true,
      activityLogs: true,
      auditLogs: true,
      priorityQueue: true,
      fasterPreview: true,
      apiAccess: true,
      webhooks: true,
      customBranding: true,
      earlyAccess: true,
      multipleOrganizations: true,
      dedicatedSupport: true,
      customIntegrations: true,
      sla: true,
      whiteLabel: true,
      customDomain: true,
      accountManager: true,
      betaFeatures: true,
      onboarding: true,
      securityLogs: true
    }
  }
};

function getPlan(key) {
  return PLANS[key] || PLANS.free;
}

function isAtLeast(planKey, minKey) {
  return PLAN_ORDER.indexOf(planKey) >= PLAN_ORDER.indexOf(minKey);
}

function hasFlag(planKey, flag) {
  const idx = PLAN_ORDER.indexOf(planKey);
  if (idx === -1) return false;
  for (let i = 0; i <= idx; i++) {
    if (PLANS[PLAN_ORDER[i]].flags[flag]) return true;
  }
  return false;
}

function limit(planKey, resource) {
  return getPlan(planKey).limits[resource];
}

function exceedsLimit(planKey, resource, current) {
  const max = limit(planKey, resource);
  return max !== Infinity && current >= max;
}

module.exports = {
  PLANS,
  PLAN_ORDER,
  getPlan,
  isAtLeast,
  hasFlag,
  limit,
  exceedsLimit
};
