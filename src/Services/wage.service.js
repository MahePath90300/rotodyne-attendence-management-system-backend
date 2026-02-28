const { addDays, format } = require("date-fns");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");
const AttendanceSummary = require("../models/AttendanceSummary");

const { resolveWagePolicy } = require("../config/wagePolicy");
const { resolveAttendanceCycle } = require("../config/attendanceCycle");

const {
  resolveDailyWage,
  resolveESI,
  resolveContributionBase,
  resolveOTAmount,
  calculateEmployeeHolidayDays,
  round2,
  roundUp,
  resolveOtherDeduction,
} = require("../Helpers/helper");

/**
 * ✅ EXACT SAME DATA AS EXCEL
 * NO LOGIC CHANGE
 */
exports.generateSiteWageData = async ({ siteId, year, month }) => {
  const policy = await resolveWagePolicy(siteId);
  const cycle = resolveAttendanceCycle(siteId);
  const { start, end } = cycle.buildRange(year, month);

  const days = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    days.push(format(d, "yyyy-MM-dd"));
  }

  const sundaySet = new Set(days.filter((d) => new Date(d).getDay() === 0));

  const startStr = format(new Date(start), "yyyy-MM-dd");
  const endStr = format(new Date(end), "yyyy-MM-dd");

  // ================= LOAD DATA =================

  const employees = await Employee.find({ site: siteId })
    .sort({ name: 1 })
    .lean();

  const attendance = await Attendance.find({
    siteId,
    date: { $gte: startStr, $lte: endStr },
  }).lean();

  const holidays = await Holiday.find({
    site: siteId,
    date: { $gte: startStr, $lte: endStr },
  }).lean();

  const summaries = await AttendanceSummary.find({
    siteId,
    year,
    month,
  }).lean();

  const summaryByEmp = {};
  summaries.forEach((s) => (summaryByEmp[s.empNo] = s));

  const holidaySet = new Set(
    holidays.map((h) => format(new Date(h.date), "yyyy-MM-dd")),
  );

  const attByEmp = {};
  attendance.forEach((doc) => {
    const iso = format(new Date(doc.date), "yyyy-MM-dd");
    if (!attByEmp[doc.empNo]) attByEmp[doc.empNo] = {};
    attByEmp[doc.empNo][iso] = doc.status;
  });

  // ================= MAIN LOOP =================

  const rows = [];

  for (const emp of employees) {
    const summary = summaryByEmp[emp.empNo] || {};
    const empAtt = attByEmp[emp.empNo] || {};

    const presentDays = Number(summary.totalPresentDays || 0);
    const coffDays = Number(summary.totalCOffDays || 0);
    const otHours = Number(summary.otHours || 0);

    const isFixed = emp.salaryType === "FIXED";

    const grossIncludesDeductions =
      isFixed && typeof emp.grossIncludesDeductions === "boolean"
        ? emp.grossIncludesDeductions
        : false;

    const empHolidayDays = calculateEmployeeHolidayDays({
      days,
      holidaySet,
      sundaySet,
      empAtt,
      presentDays,
    });

    const paidDays =
      presentDays === 0 ? 0 : presentDays + coffDays + empHolidayDays;

    const totalDays = days.length - sundaySet.size;

    const dailyWage = resolveDailyWage(emp, policy);

    const gross =
      emp.salaryType === "FIXED" ? emp.salary : dailyWage * totalDays;

    // ===== EXACT EXCEL CALCULATION =====

    const erngBaDa = dailyWage * paidDays;

    const erngOtAmt = resolveOTAmount({
      siteId,
      emp,
      policy,
      otHours,
      dailyWage,
    });

    const perDayGross = totalDays > 0 ? (gross * paidDays) / totalDays : 0;

    const balance = perDayGross - erngBaDa;

    const erngHra = balance * 0.5;
    const erngConv = balance * 0.35;
    const erngMed = balance * 0.15;
    const erngArrear = 0;

    const erngOtherPerDay =
      typeof policy.erngOtherPayAmount === "object"
        ? policy.erngOtherPayAmount[siteId] || 0
        : policy.erngOtherPayAmount || 0;

    const erngOtherPay = paidDays * erngOtherPerDay;
    const erngSiteDa = Number(emp?.siteDa || 0);
    const erngAda = 0;

    let erngOnBas = 0;
    let erngOnDuty = 0;
    let dednESI = 0;
    const onBasicPercent =
      typeof policy.erngOnBasicPercent === "object"
        ? policy.erngOnBasicPercent[siteId] || 0
        : policy.erngOnBasicPercent || 0;

    erngOnBas = erngBaDa * onBasicPercent;

    const onDutyPerDay =
      typeof policy.erngOnDutyPerDay === "object"
        ? policy.erngOnDutyPerDay[siteId] || 0
        : policy.erngOnDutyPerDay || 0;

    erngOnDuty = paidDays * onDutyPerDay;

    // ===== ROUNDING SAME AS EXCEL =====

    const erngBaDaR = round2(erngBaDa);
    const erngHraR = round2(erngHra);
    const erngConvR = round2(erngConv);
    const erngMedR = round2(erngMed);
    const erngOnBasR = round2(erngOnBas);
    const erngOnDutyR = round2(erngOnDuty);
    const erngOtAmtR = round2(erngOtAmt);
    const erngOtherPayR = round2(erngOtherPay);

    const erngSubTot1 = erngBaDaR + erngHraR + erngConvR + erngMedR + erngAda;

    const erngSubTot2 = erngSubTot1 + erngOnBasR + erngOnDutyR;

    const erngTotal =
      erngArrear + erngOtherPayR + erngOtAmtR + erngSiteDa + erngSubTot2;

    // ===== DEDUCTIONS (EXACT) =====

    const esiPolicy =
      typeof policy.esi === "object" && policy.esi[siteId]
        ? policy.esi[siteId]
        : policy.esi;

    dednESI = resolveESI(
      erngBaDa,
      erngOnDuty,
      gross,
      esiPolicy,
      emp.esiApplicable,
      erngTotal,
    );

    const pfBase = resolveContributionBase(erngBaDa, erngOnDuty, policy.pf);

    const dednEPF =
      policy.pf?.enabled && emp?.pfApplicable !== false
        ? Math.min(pfBase * policy.pf.percent, policy.pf.maxAmount || Infinity)
        : 0;

    const dednEPFIncAdmin =
      policy.pf?.enabled && emp?.pfApplicable !== false
        ? Math.min(pfBase * 0.12, policy.pf.maxAmount || Infinity) +
          pfBase * 0.01
        : 0;

    const dednOther = resolveOtherDeduction({
      emp,
      siteId,
      salaryType: emp.salaryType,
      policy,
      erngTotal,
      erngOnBas,
      erngOnDuty,
      paidDays,
      otHours,
      erngOtAmt,
    });

    const dednEPFR = round2(dednEPF);
    const dednESIR = roundUp(dednESI);
    const dednOtherR = round2(dednOther);
    const dednPtax = (paidDays !== 0 ? emp?.pTax : 0) ?? 0;

    const dednTotal =
      dednEPFR +
      dednESIR +
      0 + // loan
      0 + // tds
      0 + // advance
      dednPtax + // ptax
      dednOtherR;

    let netPayable = 0;
    if (isFixed && grossIncludesDeductions) {
      netPayable = Math.floor(gross - (dednEPFR + dednESIR));
    } else {
      netPayable = Math.floor(erngTotal - dednTotal);
    }

    // ===== FNF + CTC (EXACT CLIENT RULE) =====

    const fnfPolicy = policy.fnf || {};

    let leaveEncashment = 0;
    let refreshment = 0;
    let noticePay = 0;
    let bonus = 0;

    if (fnfPolicy.enabled !== false && !fnfPolicy.includedInOnBasic) {
      if (fnfPolicy.components?.leaveEncashment) {
        leaveEncashment = erngBaDa * 0.05;
      }

      if (fnfPolicy.components?.refreshment) {
        refreshment = erngBaDa * 0.049;
      }

      if (fnfPolicy.components?.noticePay) {
        noticePay = erngBaDa * 0.049;
      }
      if (fnfPolicy.components?.bonus) {
        bonus = erngBaDa * 0.0833;
      }
    }

    const totalFnf = leaveEncashment + refreshment + noticePay + bonus;
    const totalFnfR =
      round2(leaveEncashment) +
      round2(refreshment) +
      round2(noticePay) +
      round2(bonus);

    const employerPF = round2(dednEPFIncAdmin);
    const employerESI =
      round2(Number(((dednESI / 0.0075) * 0.0325).toFixed(2))) || 0;

    const salary = erngSubTot1;

    const allowances =
      erngOnBasR + erngOnDutyR + erngSiteDa + erngOtherPay + erngArrear;

    const totalCTC =
      salary + erngOtAmtR + allowances + totalFnfR + employerPF + employerESI;

    rows.push({
      empNo: emp.empNo,
      name: emp.name,
      category: emp.category,

      gross: round2(gross),
      dailyWage: round2(dailyWage),

      totalDays,
      presentDays,
      coffDays,
      holidays: empHolidayDays,
      paidDays,

      salary: round2(salary),
      otAmount: round2(erngOtAmt),
      allowances: round2(allowances),

      dednTotal: round2(dednTotal),
      netPayable,

      totalFnf: round2(totalFnf),
      employerPF,
      employerESI: round2(employerESI),
      totalCTC: round2(totalCTC),
    });
  }

  const summary = {
    totalPayout: rows.reduce((s, r) => s + r.netPayable, 0),
    totalDeductions: rows.reduce((s, r) => s + r.dednTotal, 0),
  };

  return {
    siteId,
    year,
    month,
    cycle: cycle.label(year, month),
    rows,
    summary,
  };
};
