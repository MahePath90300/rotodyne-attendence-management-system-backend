export const WAGE_POLICIES = {
  NTPC: {
    sites: {
      GADARWARA: {
        dailyWageByCategory: {
          HSW: 893,
          SW: 760,
          SSW: 632,
          USW: 541,
        },
        erngOnBasicPercent: 0.0833,
        erngOnDutyPerDay: 0,
        otRateDivisor: 4,
        dednOtherEnabled: true,
        erngOtherPayAmount: 0,
        shouldErngOnDutyAdded: false,
        pf: {
          enabled: true,
          percent: 0.12,
          maxAmount: 1800,
          includeOnDuty: false,
        },
        esi: { enabled: false },
      },

      DADRI: {
        dailyWageByCategory: {
          HSW: 893,
          SW: 760,
          SSW: 632,
          USW: 541,
        },
        erngOnBasicPercent: 0.1744,
        erngOnDutyPerDay: 0,
        otRateDivisor: 4,
        dednOtherEnabled: true,
        erngOtherPayAmount: 0,
        shouldErngOnDutyAdded: false,
        pf: {
          enabled: true,
          percent: 0.12,
          maxAmount: 1800,
          includeOnDuty: false,
        },
        esi: { enabled: false },
      },

      KANIHA: {
        dailyWageByCategory: {
          HSW: 893,
          SW: 760,
          SSW: 632,
          USW: 541,
        },
        erngOnBasicPercent: 0.1744,
        erngOnDutyPerDay: 50,
        otRateDivisor: 4,
        dednOtherEnabled: true,
        erngOtherPayAmount: 0,
        shouldErngOnDutyAdded: false,

        pf: {
          enabled: true,
          percent: 0.12,
          maxAmount: 1800,
          includeOnDuty: false,
        },
        esi: {
          enabled: true,
          percent: 0.0075,
          ceiling: 21000,
          maxAmount: 1800,
          includeOnDuty: false,
        },
      },
      NABINAGAR: {
        dailyWageByCategory: {
          HSW: 893,
          SW: 760,
          SSW: 632,
          USW: 541,
        },
        erngOnBasicPercent: 0.1813,
        erngOnDutyPerDay: 0,
        otRateDivisor: 8,
        dednOtherEnabled: false,
        erngOtherPayAmount: 0,
        shouldErngOnDutyAdded: false,

        pf: {
          enabled: true,
          percent: 0.12,
          maxAmount: 1800,
          includeOnDuty: false,
        },
        esi: {
          enabled: true,
          percent: 0.0075,
          applyCeiling: false,
          maxAmount: 1800,
          includeOnDuty: false,
        },
      },
    },
  },

  NALCO: {
    sites: {
      "NALCO DAMANJODI(0405)": {
        dailyWageByCategory: null,
        erngOnBasicPercent: 0.1,
        erngOnDutyPerDay: 30,
        otRateDivisor: 4,
        dednOtherEnabled: true,
        erngOtherPayAmount: 6,
        shouldErngOnDutyAdded: true,
        pf: {
          enabled: true,
          percent: 0.12,
          maxAmount: 1800,
          includeOnDuty: true, // ✅
        },
        esi: {
          enabled: true,
          percent: 0.0075,
          applyCeiling: false,
          maxAmount: 1800,
          includeOnDuty: true,
        },
      },
    },
  },

  IOCL: {
    sites: {
      IOCLGJBS: {
        dailyWageByCategory: {
          HSW: 981,
          SW: 893,
          SSW: 760,
          USW: 674,
        },
        erngOnBasicPercent: 0.189,
        erngOnDutyPerDay: 0,
        otRateDivisor: 4,
        dednOtherEnabled: false,
        erngOtherPayAmount: 0,
        shouldErngOnDutyAdded: true,
        pf: {
          enabled: true,
          percent: 0.12,
          maxAmount: 1800,
          includeOnDuty: false,
        },

        esi: {
          enabled: true,
          percent: 0.0075,
          ceiling: 21000,
          maxAmount: 1800,
        },
      },
    },
  },
};

/**
 * Group resolver
 */
export const SITE_WAGE_GROUP = {
  GADARWARA: "NTPC",
  DADRI: "NTPC",
  KANIHA: "NTPC",

  "NALCO DAMANJODI(0405)": "NALCO",
  IOCLGJBS: "IOCL",
};

/**
 * Final resolver (ALWAYS returns same shape)
 */
export function resolveWagePolicy(siteId) {
  const group = SITE_WAGE_GROUP[siteId] || "NTPC";
  const policyGroup = WAGE_POLICIES[group];

  const sitePolicy = policyGroup.sites[siteId];

  if (!sitePolicy) {
    throw new Error(`No wage policy found for site ${siteId}`);
  }

  return sitePolicy;
}
