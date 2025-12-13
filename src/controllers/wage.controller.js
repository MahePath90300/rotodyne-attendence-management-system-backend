// src/controllers/wage.controller.js
const ExcelJS = require("exceljs");
const { addDays, format } = require("date-fns");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const Holiday = require("../models/Holiday");
const AttendanceSummary = require("../models/AttendanceSummary");

// ---- wage constants ----
const DAILY_WAGE_BY_CAT = {
  HSW: 893,
  SW: 760,
  SSW: 632,
  USW: 541,
};

const WAGE_HEADERS = [
  "Sl no",           // 1
  "Month numbr",     // 2
  "Emp no",          // 3
  "Name",            // 4
  "Dsg",             // 5
  "Cat",             // 6
  "Manpwr Typ",      // 7
  "Gross",           // 8
  "v%",              // 9
  "Daily Minw",      // 10
  "Total days",      //11
  "Prsnt Days",      //12
  "Abs days",        //13
  "CL day",          //14
  "Coff Days",       //15
  "Holidays",        //16  <- per-employee holidays (from AttendanceSummary.totalHolidays if available)
  "Paid Days",       //17
  "Site days",       //18
  "Emg ba+da",       //19  (reserved)
  "EmAda",           //20  (reserved)
  "Emg HRA",         //21  (reserved)
  "Emg Conv",        //22  (reserved)
  "Emg Med",         //23  (reserved)
  "Emg Sub Tot",     //24
  "Emg onBas",       //25
  "Emg onDy",        //26
  "Emg Sub Tot",     //27
  "EMg SitDa",       //28
  "OT hrs",          //29
  "Earng OTamt",     //30
  "Emg othPy",       //31
  "Emg Arrear",      //32
  "Emg total",       //33
  "PF pay",          //34 Employer PF? (we keep as gross * 12%)
  "Esi pay",         //35 Employer ESI? (we keep as gross * 2%)
  "dedn EPF",        //36 Deduction EPF from employee (12% on paid days*dailyWage)
  "dedn ESI",        //37 Deduction ESI from employee (2% on paid days*dailyWage)
  "Ded Lon",         //38
  "Ded TDS",         //39
  "Ded Adv",         //40
  "Ded ptax",        //41 (not calculated - reserved)
  "Ded oth",         //42
  "Dedn total",      //43
  "Net payable",     //44
];

// same 26–25 window you already use everywhere
function buildMonthWindow(year, month) {
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear = month === 1 ? year - 1 : year;
  const startDate = new Date(prevYear, prevMonth - 1, 26);
  const endDate = new Date(year, month - 1, 25);
  const days = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    days.push(format(d, "yyyy-MM-dd"));
  }
  return {
    start: format(startDate, "yyyy-MM-dd"),
    end: format(endDate, "yyyy-MM-dd"),
    days,
  };
}

/**
 * GET /api/v1/wage/site/:siteId/export?year=YYYY&month=MM
 * Only ADMIN is allowed to export.
 */
exports.exportSiteWageSheet = async (req, res, next) => {
  try {
    const { siteId } = req.params;
    const year = Number(req.query.year);
    const month = Number(req.query.month);

    if (!siteId || !year || !month) {
      return res.status(400).json({ message: "siteId, year, month required" });
    }

    const role = (req.user?.role || "").toUpperCase();
    if (role !== "ADMIN") {
      return res.status(403).json({ message: "Only admin can export wage sheet" });
    }

    const { start, end, days } = buildMonthWindow(year, month);

    // 1) employees of this site sorted by name
    const employees = await Employee.find({ site: siteId })
      .sort({ name: 1 })
      .lean();

    if (!employees.length) {
      return res.status(404).json({ message: "No employees for this site" });
    }

    // 2) attendance in that window (status + otHours)
    const attDocs = await Attendance.find({
      siteId,
      date: { $gte: start, $lte: end },
    }).lean();

    // Build maps: statuses and ot
    const attByEmp = {}; // { empNo: { iso: status } }
    const otByEmp = {}; // { empNo: { iso: otHours } }
    for (const doc of attDocs) {
      if (!attByEmp[doc.empNo]) attByEmp[doc.empNo] = {};
      if (!otByEmp[doc.empNo]) otByEmp[doc.empNo] = {};
      if (doc.status) attByEmp[doc.empNo][doc.date] = doc.status;
      if (typeof doc.otHours !== "undefined" && doc.otHours !== null) {
        otByEmp[doc.empNo][doc.date] = Number(doc.otHours) || 0;
      }
    }

    // 3) holidays for this site (use holiday collection 'site' field) -> public holidays
    const holidayDocs = await Holiday.find({
      site: siteId,
      date: { $gte: start, $lte: end },
    }).lean();
    const holidaySet = new Set(holidayDocs.map((h) => h.date)); // site-level public holidays

    // 4) Sundays in that window
    const sundaySet = new Set(days.filter((iso) => new Date(iso).getDay() === 0));

    // 5) Load AttendanceSummary entries for this site / month (to read per-employee totalHolidays)
    const summaries = await AttendanceSummary.find({
      siteId,
      year,
      month,
    }).lean();
    const summaryByEmp = {};
    for (const s of summaries) {
      // empNo might be number or missing (site-level summary may be present)
      if (typeof s.empNo !== "undefined" && s.empNo !== null) {
        summaryByEmp[s.empNo] = s;
      } else if (s.siteId && !s.empNo) {
        // site-level summary: ignore for per-emp mapping (we rely on employee summaries)
      }
    }

    // 6) build workbook
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Wage Sheet", {
      views: [{ state: "frozen", ySplit: 1 }],
    });

    // header row
    ws.addRow(WAGE_HEADERS);
    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true, size: 10 };
    headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF3F4F6" },
      };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // column widths (tweakable)
    const colWidths = [
      6, 10, 10, 28, 14, 10, 12, 12, 6, 10, 10, 10, 10, 8, 10, 10, 10, 8,
      10, 10, 10, 10, 10, 10, 10, 10, 10, 8, 12, 10, 10, 12, 10, 10, 10, 10,
      10, 10, 10, 10, 10, 12, 12,
    ];
    ws.columns = colWidths.map((w) => ({ width: w }));

    // serial
    let sl = 1;

    // Precompute site-level calendar counts
    const calendarDays = days.length;
    const sitePublicHolidaysCount = holidaySet.size;
    const siteSundaysCount = sundaySet.size;
    // totalDays (as requested): monthly calendar days - sundays - public holidays (site-level)
    const totalDaysForSite = calendarDays - siteSundaysCount - sitePublicHolidaysCount;

    for (const emp of employees) {
      const cat = (emp.category || "").toUpperCase();
      const dailyWage = DAILY_WAGE_BY_CAT[cat] || 0;

      // per-employee attendance + ot maps
      const empAtt = attByEmp[emp.empNo] || {};
      const empOtMap = otByEmp[emp.empNo] || {};

      // If AttendanceSummary provides employee totalHolidays, use it (preferred)
      const summary = summaryByEmp[emp.empNo];
      const summaryHolidays = summary?.totalHolidays; // may be undefined

      // counters
      let presentDays = 0; // PP=1, P=0.5, HW=1
      let absentDays = 0; // AA=1, A=0.5
      let clDays = 0; // CC
      let coffDays = 0; // not currently tracked separately (kept 0)
      let weekOffDays = 0; // WW
      let holidayWorkDays = 0; // HW
      let holidaysForEmp = 0; // HH count for emp (we will prefer summary)
      let otHours = 0;

      // iterate days and compute counts
      for (const iso of days) {
        const status = empAtt[iso] || ""; // blank if not present in attendance collection
        // count status
        if (status === "PP") presentDays += 1;
        else if (status === "P") presentDays += 0.5;
        else if (status === "AA") absentDays += 1;
        else if (status === "A") absentDays += 0.5;
        else if (status === "CC") clDays += 1;
        else if (status === "WW") weekOffDays += 1;
        else if (status === "HW") {
          holidayWorkDays += 1;
          presentDays += 1; // HW counts as present for presentDays
        } else if (status === "HH") {
          holidaysForEmp += 1;
        }

        // OT accumulation (take stored ot if present)
        if (typeof empOtMap[iso] !== "undefined" && empOtMap[iso] !== null) {
          otHours += Number(empOtMap[iso]) || 0;
        } else {
          // no explicit ot stored: if status === 'HW' treat as 8 hours only if required
          // NOTE: business rule: backend may auto-store otMap; if not, we can optionally treat HW as 8 OT.
          // We'll *prefer explicit* OT values; if none present, count HW as 8 hours of OT (per earlier UX).
          if (status === "HW") otHours += 8;
        }
      }

      // Use summary totalHolidays if available, otherwise fall back to counted HH statuses
      const holidaysCount = typeof summaryHolidays !== "undefined" ? Number(summaryHolidays) : holidaysForEmp;

      // Total calendar days to show (site-level): calendarDays
      // Total days for wage calc as requested: monthly calendar days - sundays - public holidays
      const totalDays = totalDaysForSite;

      // Present days defined earlier; note HW already added to presentDays
      // Paid days formula requested: presentDays + CC + WW - HW
      const paidDays = presentDays + clDays + weekOffDays - holidayWorkDays;

      // OT amounts
      const otRatePerHour = dailyWage / 4; // -> as per previous calculation
      const otAmount = otHours * otRatePerHour;

      // Gross: previous behavior used dailyWage * 30
      const gross = dailyWage * 30;

      // Employer contributions columns you requested:
      const PF_pay = gross * 0.12; // "PF pay: deduct 12% of gross pay" — keep as computed column
      const ESI_pay = gross * 0.02; // "ESI pay: deduct 2% of gross pay"

      // Deduction from employee (per your instruction):
      // dedn EPF: 12% on paid days (paidDays * dailyWage * 0.12)
      // dedn ESI: 2% on paid days (paidDays * dailyWage * 0.02)
      const paidDaysWage = Math.max(0, paidDays) * dailyWage;
      const dednEPF = paidDaysWage * 0.12;
      const dednESI = paidDaysWage * 0.02;

      // total earnings for employee before deductions (present-based + OT)
      const emgTotal = paidDays * dailyWage + otAmount;

      // Net payable = emgTotal - (deductions)  (we leave room for other deductions)
      const totalDeductions = dednEPF + dednESI;
      const netPayable = emgTotal - totalDeductions;

      // Build row in exact header order (44 columns)
      const rowValues = [
        sl, // Sl no
        month, // Month numbr
        emp.empNo || "", // Emp no
        emp.name || "", // Name
        emp.designation || "", // Dsg
        emp.category || "", // Cat
        (emp.manpowerType || emp.siteType || "") || "", // Manpwr Typ
        round2(gross), // Gross
        0, // v% (reserved)
        round2(dailyWage), // Daily Minw
        totalDays, // Total days (site-level rule)
        round2(presentDays), // Prsnt Days (PP + P + HW)
        round2(absentDays), // Abs days
        round2(clDays), // CL day (CC)
        round2(coffDays), // Coff Days
        Number(holidaysCount || 0), // Holidays (prefer AttendanceSummary.totalHolidays)
        round2(paidDays), // Paid Days (present + CC + WW - HW)
        0, // Site days (reserved)
        0, // Emg ba+da (reserved)
        0, // EmAda (reserved)
        0, // Emg HRA (reserved)
        0, // Emg Conv (reserved)
        0, // Emg Med (reserved)
        0, // Emg Sub Tot (reserved)
        0, // Emg onBas (reserved)
        0, // Emg onDy (reserved)
        0, // Emg Sub Tot (reserved)
        0, // EMg SitDa (reserved)
        round2(otHours), // OT hrs
        round2(otAmount), // Earng OTamt
        0, // Emg othPy (reserved)
        0, // Emg Arrear (reserved)
        round2(emgTotal), // Emg total (paidDays*dailyWage + ot)
        round2(PF_pay), // PF pay (gross * 12%)
        round2(ESI_pay), // Esi pay (gross * 2%)
        round2(dednEPF), // dedn EPF (12% on paid days*dailyWage)
        round2(dednESI), // dedn ESI (2% on paid days*dailyWage)
        0, // Ded Lon
        0, // Ded TDS
        0, // Ded Adv
        0, // Ded ptax (not calculated)
        0, // Ded oth
        round2(totalDeductions), // Dedn total
        round2(netPayable), // Net payable
      ];

      const newRow = ws.addRow(rowValues);

      // formatting for numeric cells
      newRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber >= 1 && colNumber <= 44) {
          cell.alignment = { vertical: "middle", horizontal: colNumber === 4 ? "left" : "center" };
        }
        const currencyCols = new Set([8, 10, 30, 33, 34, 35, 36, 37, 41, 42, 44]);
        if (currencyCols.has(colNumber) && typeof cell.value === "number") {
          cell.numFmt = '#,##0.00';
        }
        cell.border = {
          top: { style: "thin" },
          bottom: { style: "thin" },
          left: { style: "thin" },
          right: { style: "thin" },
        };
      });

      // alternate row shading
      if (sl % 2 === 0) {
        newRow.eachCell((cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFF8FAFB" },
          };
        });
      }

      sl += 1;
    }

    // stream workbook to response
    const fileName = `wage_sheet_${siteId}_${year}_${month}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
};

// small helper
function round2(v) {
  if (typeof v !== "number") v = Number(v) || 0;
  return Math.round(v * 100) / 100;
}
