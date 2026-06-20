import express from "express";
import { AuthMiddleware } from "../middlewares/auth.middleware.js";
import { exportLimiter } from "../middlewares/rateLimiter.js";
import { downloadExport, exportQuestions, getExportStatus } from "../controllers/exportController.js";

const router = express.Router();

router.post('/export/:sessionId', AuthMiddleware, exportLimiter, exportQuestions);

router.get('/status/:jobId', AuthMiddleware, getExportStatus);

router.get('/download/:filename', AuthMiddleware, downloadExport);

export default router;