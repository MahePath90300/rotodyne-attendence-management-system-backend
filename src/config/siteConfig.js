const SITE_CONFIG = {
  // =====================
  // 26 → 25 cycle sites
  // =====================
  GADARWARA: { cycle: "26_25" },
  DADRI: { cycle: "26_25" },
  KANIHA: { cycle: "26_25" },
  LARA: { cycle: "26_25" },

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
  WANAKBORI: { cycle: "CALENDAR" },
  IEPL9308: { cycle: "CALENDAR" },
  IEPLOPER: { cycle: "CALENDAR" },
  MECONNMDC: { cycle: "CALENDAR" },
  RCFTHAL9253: { cycle: "CALENDAR" },
  SERVICES: { cycle: "CALENDAR" },
  IOCLGJCGP: { cycle: "CALENDAR" },

  // ✅ JPL sites (NEW)
  "JPLSBOP 9541": { cycle: "21_20" },
  JPLSTG9540: { cycle: "21_20" },
};

function getSiteConfig(siteId) {
  return (
    SITE_CONFIG[String(siteId).toUpperCase()] || {
      cycle: "26_25", // safe default
    }
  );
}

module.exports = { getSiteConfig };
