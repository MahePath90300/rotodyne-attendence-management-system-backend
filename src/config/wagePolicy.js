const WagePolicy = require("../models/WagePolicy");

async function resolveWagePolicy(siteId) {
  const policy = await WagePolicy.findOne({
    siteId,
    isActive: true,
  }).lean();

  if (!policy) {
    throw new Error(`No wage policy found for site ${siteId}`);
  }

  return policy;
}

module.exports = { resolveWagePolicy };
