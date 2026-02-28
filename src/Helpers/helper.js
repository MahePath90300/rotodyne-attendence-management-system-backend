function resolveDailyWage(emp, policy) {
  // ✅ NALCO / custom sites
  if (Number(emp.dailyWageRate) > 0) {
    return Number(emp.dailyWageRate);
  }

  // ✅ NTPC / IOCL
  return policy.dailyWageByCategory?.[emp.category] || 0;
}

function resolveOtherDeduction({
  emp,
  siteId,
  salaryType,
  policy,
  erngTotal,
  erngOnBas,
  erngOnDuty,
  paidDays,
  otHours,
  erngOtAmt,
}) {
  const isFixed = salaryType === "FIXED";

  // const otherDednApplicable =
  //   !isFixed || emp.otherDeductionsApplicable !== false;

  // if (!policy.dednOtherEnabled || !otherDednApplicable) {
  //   return 0;
  // }
  // Site level switch
  if (!policy.dednOtherEnabled) {
    return 0;
  }

  // Employee must explicitly allow deduction
  if (emp.otherDeductionsApplicable !== true) {
    return 0;
  }

  // ======================================
  // 🔴 KANIHA TEMP MWB EMPLOYEES
  // ======================================
  const isKanihaTempMWB =
    siteId === "KANIHA" &&
    salaryType === "MWB" &&
    emp.isTemporary === true &&
    Number(emp.tempMinWage) > 0;

  if (isKanihaTempMWB) {
    const minWage = Number(emp.tempMinWage);
    const siteOtAmountPerHour = round2(minWage / 4);

    const clientTotalPay = minWage * paidDays + siteOtAmountPerHour * otHours;

    const diff = erngTotal - clientTotalPay;

    return diff > 0 ? Math.round(diff) : 0;
  }

  const hasSitePayAmount =
    siteId === "KANIHA" && isFixed && Number(emp.sitePayAmount) > 0;

  if (hasSitePayAmount) {
    const clientTotalPay = Number(emp.sitePayAmount);

    const diff = erngTotal - clientTotalPay;

    return diff > 0 ? Math.round(diff) : 0;
  }

  if (
    typeof emp.otherDeductionAmount === "number" &&
    emp.otherDeductionAmount > 0
  ) {
    return Math.round(emp.otherDeductionAmount);
  }

  // if (
  //   (isFixed && emp?.grossIncludesDeductions !== true) ||
  //   (emp?.grossIncludesDeductions !== true &&
  //     emp?.otherDeductionsApplicable === true)
  // ) {
  //   return Math.round(erngOnBas + erngOnDuty+ erngOtAmt);
  // }
  const cfg = emp.otherDeductionOverride
    ? emp.otherDeductionOverride
    : policy.otherDeductionComponents || {};

  if (!cfg || Object.keys(cfg).length === 0) {
    return 0;
  }

  let deduction = 0;

  if (cfg.includeOnBasic) deduction += erngOnBas || 0;
  if (cfg.includeOnDuty) deduction += erngOnDuty || 0;
  if (cfg.includeOT) deduction += erngOtAmt || 0;

  return Math.round(deduction);
}

function resolveESI(
  erngBaDa,
  erngOnDuty,
  gross,
  esiPolicy,
  esiApplicable,
  erngTotal,
) {
  if (!esiPolicy?.enabled) return 0;

  // 🔹 Ceiling blocks ONLY when esiApplicable is NOT explicitly true
  if (esiPolicy.applyCeiling !== false && esiApplicable !== true) {
    if (esiPolicy.ceiling && gross > esiPolicy.ceiling) {
      return 0;
    }
  }

  // 🔹 If esiApplicable === false → never deduct
  if (esiApplicable === false) return 0;

  let base = 0;

  if (esiPolicy.esiBasedOnEarngTotal === true) {
    // 🔵 DADRI behavior
    base = erngTotal;
  } else {
    // 🔵 all other sites
    base = resolveContributionBase(erngBaDa, erngOnDuty, esiPolicy);
  }

  if (!base || base <= 0) return 0;

  let amt = base * esiPolicy.percent;

  if (esiPolicy.maxAmount) {
    amt = Math.min(amt, esiPolicy.maxAmount);
  }

  return amt;
}

function resolveContributionBase(erngBaDa, erngOnDuty, policySection) {
  if (!policySection?.enabled) return 0;

  return policySection.includeOnDuty ? erngBaDa + erngOnDuty : erngBaDa;
}

function normalizeDesignation(desg = "") {
  return desg.toUpperCase().replace(/\./g, "").replace(/\s+/g, "");
}

function resolveOTAmount({ siteId, emp, policy, otHours, dailyWage }) {
  if (!otHours || otHours <= 0) return 0;

  const otPolicy = policy.ot;

  const DESIGNATION_KEY_MAP = {
    BTECH: "BTech",
    GRADUATE: "Graduate",
    DIPLOMA: "Diploma",
  };

  // ==============================
  // 🔵 DESIGNATION BASED OT
  // ==============================
  if (
    otPolicy?.type === "DESIGNATION" &&
    otPolicy.ratePerHour &&
    emp.designation
  ) {
    const norm = normalizeDesignation(emp.designation);
    const key = DESIGNATION_KEY_MAP[norm];

    if (key && otPolicy.ratePerHour[key]) {
      return otHours * Number(otPolicy.ratePerHour[key]);
    }
  }

  // ==============================
  // 🔵 DIVISOR BASED OT (DEFAULT)
  // ==============================
  const divisor = otPolicy?.divisor || 4;
  return (dailyWage / divisor) * otHours;
}

function calculateEmployeeHolidayDays({
  days,
  holidaySet,
  sundaySet,
  empAtt,
  presentDays,
}) {
  if (!presentDays || presentDays === 0) {
    return 0;
  }
  let holidayCount = 0;

  for (const date of days) {
    // must be site holiday
    if (!holidaySet.has(date)) continue;

    // skip Sundays
    if (sundaySet.has(date)) continue;

    const status = empAtt?.[date];

    // ❌ absent → no holiday
    if (status === "A") continue;

    // ✅ holiday counted in all other cases
    // H, HW, P, or even empty (default holiday)
    holidayCount++;
  }

  return holidayCount;
}

// small helper
function round2(v) {
  if (v === null || v === undefined || isNaN(v)) return 0;
  return Math.round(v);
}

function roundUp(v) {
  if (v === null || v === undefined || isNaN(v)) return 0;
  return Math.ceil(v);
}

function roundDown(v) {
  if (v === null || v === undefined || isNaN(v)) return 0;
  return Math.floor(v);
}

module.exports = {
  roundUp,
  round2,
  calculateEmployeeHolidayDays,
  resolveDailyWage,
  resolveOtherDeduction,
  resolveESI,
  resolveContributionBase,
  normalizeDesignation,
  resolveOTAmount,
};
