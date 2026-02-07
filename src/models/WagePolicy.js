const mongoose = require("mongoose");

const OtPolicySchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ["DIVISOR", "DESIGNATION"],
      default: "DIVISOR",
    },

    divisor: {
      type: Number,
      default: 4,
    },

    ratePerHour: {
      type: Map,
      of: Number, // BTech → 200
    },
  },
  { _id: false },
);

const PfPolicySchema = new mongoose.Schema(
  {
    enabled: Boolean,
    percent: Number,
    maxAmount: Number,
    includeOnDuty: Boolean,
  },
  { _id: false },
);

const EsiPolicySchema = new mongoose.Schema(
  {
    enabled: Boolean,
    percent: Number,
    ceiling: Number,
    maxAmount: Number,
    includeOnDuty: Boolean,
    applyCeiling: {
      type: Boolean,
      default: true,
    },
    esiBasedOnEarngTotal: Boolean,
  },
  { _id: false },
);

const WagePolicySchema = new mongoose.Schema(
  {
    siteId: {
      type: String,
      required: true,
      index: true,
    },

    group: {
      type: String, // NTPC / IOCL / NALCO
      required: true,
    },

    dailyWageByCategory: {
      type: Map,
      of: Number,
    },

    erngOnBasicPercent: Number,
    erngOnDutyPerDay: Number,

    ot: OtPolicySchema,

    dednOtherEnabled: Boolean,

    erngOtherPayAmount: {
      type: Number,
      default: 0,
    },

    shouldErngOnDutyAdded: Boolean,

    pf: PfPolicySchema,
    esi: EsiPolicySchema,

    isActive: {
      type: Boolean,
      default: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },

    updatedAt: Date,
  },
  { collection: "wage_policies" },
);

WagePolicySchema.pre("save", function () {
  this.updatedAt = new Date();
});

module.exports = mongoose.model("WagePolicy", WagePolicySchema);
