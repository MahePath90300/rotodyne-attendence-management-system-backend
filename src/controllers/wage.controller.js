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
  "Sl No",
  "Month",
  "Emp No",
  "Employee Name",
  "Designation",
  "Category",
  "Manpower Type",
  "Gross",
  "V%",
  "Daily Min Wages",
  "Total Working Days",
  "Present Days",
  "Absent Days",
  // "Week off Days",
  "C Off Days",
  "Holidays",
  "Paid Days",
  "Site Days",

  // ===== Earnings =====
  "Erng BA+DA",
  "Erng ADA",
  "Erng HRA",
  "Erng Conveyance",
  "Erng Medical",
  "Erng Sub Total",
  "Erng On Basic",
  "Erng On Duty",
  "Erng Sub Total 2",
  "Erng Site DA",
  "OT Hours",
  "Erng OT Amount",
  "Erng Other Pay",
  "Erng Arrear",
  "Erng Total",

  // ===== Deductions =====
  "Dedn EPF",
  "Dedn ESI",
  "Dedn Loan",
  "Dedn TDS",
  "Dedn Advance",
  "Dedn PTAX",
  "Dedn Other",
  "Dedn Total",

  "Net Payable",
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
      return res
        .status(403)
        .json({ message: "Only admin can export wage sheet" });
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
    const sundaySet = new Set(
      days.filter((iso) => new Date(iso).getDay() === 0)
    );

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
    headerRow.alignment = {
      horizontal: "center",
      vertical: "middle",
      wrapText: true,
    };
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
      6, 10, 8, 26, 10, 10, 10, 10, 5, 10, 12, 8, 8, 8, 8, 8, 6, 6, 10,
      8, 8, 8, 10, 10, 10, 10, 8, 6, 10, 10, 10, 10, 8, 6, 6, 8, 8, 8,
      8, 8, 10,
    ];
    ws.columns = colWidths.map((w) => ({ width: w }));

    // serial
    let sl = 1;

    // Precompute site-level calendar counts
    const calendarDays = days.length;
  
    for (const emp of employees) {
      const cat = (emp.category || "").toUpperCase();
      const dailyWage = DAILY_WAGE_BY_CAT[cat] || 0;

      // per-employee attendance + ot maps
      const empAtt = attByEmp[emp.empNo] || {};
      const empOtMap = otByEmp[emp.empNo] || {};

      // If AttendanceSummary provides employee totalHolidays, use it (preferred)
      const summary = summaryByEmp[emp.empNo] || {};
      const summaryHolidays = summary?.totalHolidays; // may be undefined
      const holidaysCount =
        typeof summaryHolidays !== "undefined" ? Number(summaryHolidays) : 0;

      const presentDays = Number(summary.totalPresentDays || 0);
      const weekOffDays = Number(summary.totalWeekOffs || 0);
      const coffDays = Number(summary.totalCOffs || summary.totalCOffDays || 0);
      const otHours = Number(summary.otHours || 0);
      const totalDaysForSite = Number(summary.totalDaysWorked)+ Number(summary?.totalHolidays);
      const paidDays = presentDays + coffDays + holidaysCount;

      const gross = dailyWage * totalDaysForSite;
      const totalDays = totalDaysForSite;
      const perDayGross = (gross / totalDays) * paidDays;
      const erngOtAmt = (dailyWage / 4) * otHours;
      const erngBaDa = dailyWage * paidDays;

      let erngOnBas = 0;
      let erngOnDuty = 0;
      let dednESI = 0;

      // =====================
      // SITE BASED LOGIC
      // =====================
      if (siteId === "GADARWARA") {
        // ❌ No ESI for Gadarwara
        dednESI = 0;

        // ❌ No Earn on Duty
        erngOnDuty = 0;

        // ✅ Earn on Basic = 8.33%
        erngOnBas = erngBaDa * 0.0833;
      } else if (siteId === "KANIHA") {
        // ✅ Earn on Basic = 17.44%
        erngOnBas = erngBaDa * 0.1744;

        // ✅ Earn on Duty
        erngOnDuty = paidDays * 50;

        dednESI = Math.min(erngBaDa * (0.75 / 100), 1800);
      }
      const erngHra = (perDayGross - erngBaDa) * 0.5;
      const erngConv = (perDayGross - erngBaDa) * 0.35;
      const erngMed = (perDayGross - erngBaDa) * 0.15;
      const erngArrear = 0;
      const erngOtherPay = 0;
      const erngSiteDa = 0;
      const erngAda = 0;
      const erngSubTot1 = erngBaDa + erngHra + erngConv + erngMed + erngAda;
      const erngSubTot2 = erngSubTot1 + erngOnBas + erngOnDuty;
      const erngTotal =
        erngArrear + erngOtherPay + erngOtAmt + erngSiteDa + erngSubTot2;

      const dednEPF = Math.min(erngBaDa * 0.12, 1800);

      const paidDaysWage = Math.max(0, paidDays) * dailyWage;
      const dednLon = 0;
      const dednTds = 0;
      const dednAdv = 0;
      const dednPtax = 0;
      const dednOther = 0;
      const dednTotal =
        dednEPF + dednESI + dednLon + dednTds + dednAdv + dednPtax + dednOther;
      const netPayable = erngTotal - dednTotal;
    
      let absDays = totalDays - paidDays;

      if(absDays>=0){
        absDays = totalDays - paidDays
      }else{
        absDays = 0
      }

      const rowValues = [
        sl, // Sl no
        month, // Month numbr
        emp.empNo || "", // Emp no
        emp.name || "", // Name
        emp.designation || "", // Dsg
        emp.category || "", // Cat
        emp.manpowerType || emp.siteType || "" || "", // Manpwr Typ
        round2(gross), // Gross
        0, // v% (reserved)
        round2(dailyWage), // Daily Minw
        round2(totalDays), // Total days (site-level rule)
        round2(presentDays), // Prsnt Days (PP + P + HW)
        round2(absDays), // Abs days
        // round2(weekOffDays), // CL day (CC)
        round2(coffDays), // Coff Days
        round2(Number(holidaysCount || 0)), // Holidays (prefer AttendanceSummary.totalHolidays)
        round2(paidDays), // Paid Days (present + CC + WW - HW)
        0, // Site days (reserved)
        round2(erngBaDa), // Emg ba+da (reserved)
        0, // EmAda (reserved)
        round2(erngHra), // Emg HRA (reserved)
        round2(erngConv), // Emg Conv (reserved)
        round2(erngMed), // Emg Med (reserved)
        round2(erngSubTot1), // Emg Sub Tot (reserved)
        round2(erngOnBas), // Emg onBas (reserved)
        round2(erngOnDuty),
        round2(erngSubTot2), // Emg Sub Tot (reserved)
        0, // EMg SitDa (reserved)
        round2(otHours), // OT hrs
        round2(erngOtAmt), // Earng OTamt
        0, // Emg othPy (reserved)
        0, // Emg Arrear (reserved)
        round2(erngTotal), // Emg total (paidDays*dailyWage + ot)
        round2(dednEPF), // dedn EPF (12% on paid days*dailyWage)
        round2(dednESI), // dedn ESI (2% on paid days*dailyWage)
        round2(dednLon), // Ded Lon
        round2(dednTds), // Ded TDS
        round2(dednAdv), // Ded Adv
        round2(dednPtax), // Ded ptax (not calculated)
        round2(dednOther), // Ded oth
        round2(dednTotal), // Dedn total
        round2(netPayable), // Net payable
      ];

      const newRow = ws.addRow(rowValues);

      // formatting for numeric cells
      newRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        if (colNumber >= 1 && colNumber <= 44) {
          cell.alignment = {
            vertical: "middle",
            horizontal: colNumber === 4 ? "left" : "center",
          };
        }
        const currencyCols = new Set([
          8, 10, 30, 33, 34, 35, 36, 37, 41, 42, 44,
        ]);
        if (currencyCols.has(colNumber) && typeof cell.value === "number") {
          cell.numFmt = "#,##0.00";
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
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
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
