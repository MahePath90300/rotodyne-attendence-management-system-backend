const SITE_CONFIG = {
  // =====================
  // 26 → 25 cycle sites
  // =====================
  GADARWARA: { cycle: "26_25" },
  DADRI: { cycle: "26_25" },
  KANIHA: { cycle: "26_25" },

  // =====================
  // Calendar month sites
  // =====================
  "NALCO DAMANJODI(0405)": { cycle: "CALENDAR" },
  IOCLGJBS: { cycle: "CALENDAR" },

  // 🔴 NEW SITES
  DAMANOH9252: { cycle: "CALENDAR" },
  HALDIA9426: { cycle: "CALENDAR" },
  IOCPANIPAT: { cycle: "CALENDAR" },
  NABINAGAR: { cycle: "CALENDAR" },
};

function getSiteConfig(siteId) {
  return SITE_CONFIG[String(siteId).toUpperCase()] || {
    cycle: "26_25", // safe default
  };
}

module.exports = { getSiteConfig };
