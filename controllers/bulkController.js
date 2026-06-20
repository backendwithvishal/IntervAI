// ============================================
// controllers/bulkController.js - Bulk Operations
// ============================================
import { Question } from '../models/question.model.js';
import { Session } from '../models/session.model.js';
import mongoose from 'mongoose';

/**
 * Bulk delete questions
 */
export const bulkDeleteQuestions = async (req, res) => {
    try {
        const { questionIds } = req.body;
        const userId = req.id;

        if (!Array.isArray(questionIds) || questionIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'questionIds array is required'
            });
        }

        // Validate all IDs
        const invalidIds = questionIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid question IDs found',
                invalidIds
            });
        }

        // Verify ownership
        const questions = await Question.find({ _id: { $in: questionIds } })
            .populate('session', 'user');

        const unauthorizedQuestions = questions.filter(
            q => !q.session || q.session.user.toString() !== userId
        );

        if (unauthorizedQuestions.length > 0) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized to delete some questions'
            });
        }

        // Delete questions
        const result = await Question.deleteMany({ _id: { $in: questionIds } });

        // Update sessions
        const sessionIds = [...new Set(questions.map(q => q.session._id.toString()))];
        await Session.updateMany(
            { _id: { $in: sessionIds } },
            { $pull: { questions: { $in: questionIds } } }
        );

        return res.status(200).json({
            success: true,
            message: `Successfully deleted ${result.deletedCount} questions`,
            deletedCount: result.deletedCount
        });
    } catch (error) {
        console.error('[bulkDeleteQuestions]', error);
        return res.status(500).json({
            success: false,
            message: 'Error deleting questions'
        });
    }
};

/**
 * Bulk update question difficulty
 */
export const bulkUpdateDifficulty = async (req, res) => {
    try {
        const { questionIds, difficulty } = req.body;
        const userId = req.id;

        if (!Array.isArray(questionIds) || questionIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'questionIds array is required'
            });
        }

        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid difficulty. Use: easy, medium, or hard'
            });
        }

        // Validate all IDs
        const invalidIds = questionIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid question IDs found in request',
                invalidIds
            });
        }


        // Verify ownership
        const questions = await Question.find({ _id: { $in: questionIds } })
            .populate('session', 'user');

        const unauthorizedQuestions = questions.filter(
            q => !q.session || q.session.user.toString() !== userId
        );

        if (unauthorizedQuestions.length > 0) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized to update some questions'
            });
        }

        // Update difficulty
        const result = await Question.updateMany(
            { _id: { $in: questionIds } },
            { $set: { difficulty } }
        );

        return res.status(200).json({
            success: true,
            message: `Successfully updated ${result.modifiedCount} questions`,
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('[bulkUpdateDifficulty]', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating questions'
        });
    }
};

/**
 * Bulk pin/unpin questions
 */
export const bulkTogglePin = async (req, res) => {
    try {
        const { questionIds, isPinned } = req.body;
        const userId = req.id;

        if (!Array.isArray(questionIds) || questionIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'questionIds array is required'
            });
        }

        if (typeof isPinned !== 'boolean') {
            return res.status(400).json({
                success: false,
                message: 'isPinned must be a boolean'
            });
        }

        // Validate all IDs
        const invalidIds = questionIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
        if (invalidIds.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid question IDs found in request',
                invalidIds
            });
        }


        // Verify ownership
        const questions = await Question.find({ _id: { $in: questionIds } })
            .populate('session', 'user');

        const unauthorizedQuestions = questions.filter(
            q => !q.session || q.session.user.toString() !== userId
        );

        if (unauthorizedQuestions.length > 0) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized to update some questions'
            });
        }

        // Update pin status
        const result = await Question.updateMany(
            { _id: { $in: questionIds } },
            { $set: { isPinned } }
        );

        return res.status(200).json({
            success: true,
            message: `Successfully ${isPinned ? 'pinned' : 'unpinned'} ${result.modifiedCount} questions`,
            modifiedCount: result.modifiedCount
        });
    } catch (error) {
        console.error('[bulkTogglePin]', error);
        return res.status(500).json({
            success: false,
            message: 'Error updating questions'
        });
    }
};
