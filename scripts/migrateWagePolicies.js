const mongoose = require("mongoose");
const WagePolicy = require("../src/models/WagePolicy");
const { WAGE_POLICIES, SITE_WAGE_GROUP } = require("../src/config/wagePolicy");

async function migrate() {
  await mongoose.connect("mongodb+srv://mahe:mahe447@e2e.pp12db5.mongodb.net/rotodyne-attendance-management-db");

  console.log("✅ Connected to DB");

  for (const [group, groupObj] of Object.entries(WAGE_POLICIES)) {
    const sites = groupObj.sites || {};

    for (const [siteId, policy] of Object.entries(sites)) {
      const exists = await WagePolicy.findOne({ siteId });

      if (exists) {
        console.log(`⚠️ Skipped ${siteId} (already exists)`);
        continue;
      }

      const doc = {
        siteId,
        group,

        dailyWageByCategory: policy.dailyWageByCategory || {},

        erngOnBasicPercent: policy.erngOnBasicPercent || 0,
        erngOnDutyPerDay: policy.erngOnDutyPerDay || 0,

        ot: policy.otAmountPerHour
          ? {
              type: "DESIGNATION",
              ratePerHour: policy.otAmountPerHour,
            }
          : {
              type: "DIVISOR",
              divisor: policy.otRateDivisor || 4,
            },

        dednOtherEnabled: policy.dednOtherEnabled ?? false,
        erngOtherPayAmount: policy.erngOtherPayAmount || 0,
        shouldErngOnDutyAdded: policy.shouldErngOnDutyAdded || false,

        pf: policy.pf || { enabled: false },
        esi: policy.esi || { enabled: false },

        isActive: true,
      };

      await WagePolicy.create(doc);

      console.log(`✅ Inserted policy for ${siteId}`);
    }
  }

  console.log("🎉 Wage policy migration completed");
  process.exit(0);
}

migrate().catch((err) => {
  console.error("❌ Migration failed", err);
  process.exit(1);
});
