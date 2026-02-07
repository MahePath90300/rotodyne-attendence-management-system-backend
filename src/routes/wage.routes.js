const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const wageController = require("../controllers/wage.controller");

router.get(
  "/site/:siteId/export",
  authMiddleware,
  wageController.exportSiteWageSheet,
);

router.get(
  "/site/:siteId/esi-export",
  authMiddleware,
  wageController.exportESIChallan,
);

router.get("/site/:siteId/pf-ecr", authMiddleware, wageController.exportPFECR);

module.exports = router;
