import { Session } from "../models/session.model.js";
import { Question } from "../models/question.model.js";
import mongoose from "mongoose";
import { exportQueue } from "../config/queue.js";
import path from 'path';
import fs from 'fs/promises';

export const exportQuestions = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { format } = req.query;

        // Validate format
        if (!format || !['pdf', 'csv', 'docx'].includes(format)) {
            return res.status(400).json({
                success: false,
                message: "Invalid format. Use pdf, csv, or docx"
            });
        }

        // Validate sessionId
        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid session ID"
            });
        }

        // Check if session exists and user has access
        const session = await Session.findById(sessionId).select('user').lean();
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        // Verify ownership
        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access"
            });
        }

        // Add job to queue
        const job = await exportQueue.add({
            sessionId,
            userId: req.id,
            format
        });

        return res.status(202).json({
            success: true,
            message: "Export queued successfully",
            jobId: job.id,
            checkStatusUrl: `/api/v1/export/status/${job.id}`
        });

    } catch (error) {
        console.error('[exportQuestions]', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

export const getExportStatus = async (req, res) => {
    try {
        const { jobId } = req.params;

        // Validate jobId
        if (!jobId) {
            return res.status(400).json({
                success: false,
                message: "Job ID is required"
            });
        }

        const job = await exportQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Export job not found"
            });
        }

        // Security: Verify the job belongs to the requesting user
        const jobData = job.data;
        if (jobData.userId !== req.id) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized access to this job"
            });
        }

        const state = await job.getState();

        if (state === 'completed') {
            // Use job.returnvalue for Bull v3 or await job.finished() for Bull v4
            let result;
            try {
                result = await job.finished();
            } catch (err) {
                result = job.returnvalue;
            }

            if (!result || !result.filename) {
                return res.status(500).json({
                    success: false,
                    message: "Export completed but result is missing"
                });
            }

            return res.status(200).json({
                success: true,
                status: 'completed',
                downloadUrl: `/api/v1/export/download/${result.filename}`
            });
        }

        if (state === 'failed') {
            return res.status(200).json({
                success: false,
                status: 'failed',
                error: job.failedReason || "Export failed"
            });
        }

        // For waiting, active, delayed states
        return res.status(200).json({
            success: true,
            status: state,
            message: `Export is ${state}`
        });

    } catch (error) {
        console.error('[getExportStatus]', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

export const downloadExport = async (req, res) => {
    try {
        const { filename } = req.params;

        // Validate filename
        if (!filename) {
            return res.status(400).json({
                success: false,
                message: "Filename is required"
            });
        }

        // Security: Prevent directory traversal attacks
        const sanitizedFilename = path.basename(filename);
        if (sanitizedFilename !== filename) {
            return res.status(400).json({
                success: false,
                message: "Invalid filename"
            });
        }

        const filepath = path.join(process.cwd(), 'exports', sanitizedFilename);

        // Check if file exists
        try {
            await fs.access(filepath, fs.constants.R_OK);
        } catch {
            return res.status(404).json({
                success: false,
                message: "File not found or not accessible"
            });
        }

        // Set appropriate headers
        const ext = path.extname(sanitizedFilename).toLowerCase();
        const contentTypes = {
            '.pdf': 'application/pdf',
            '.csv': 'text/csv',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };
        
        const contentType = contentTypes[ext] || 'application/octet-stream';
        res.setHeader('Content-Type', contentType);

        // Download file
        res.download(filepath, sanitizedFilename, async (err) => {
            if (err) {
                console.error('[Download Error]', err);
                if (!res.headersSent) {
                    return res.status(500).json({
                        success: false,
                        message: "Error downloading file"
                    });
                }
            } else {
                // Delete file after successful download
                try {
                    await fs.unlink(filepath);
                    console.log(`[File Deleted] ${sanitizedFilename}`);
                } catch (unlinkErr) {
                    console.error('[File Delete Error]', unlinkErr);
                }
            }
        });

    } catch (error) {
        console.error('[downloadExport]', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};