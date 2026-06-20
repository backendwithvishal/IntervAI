// ============================================
// controllers/analyticsController.js
// ============================================
import { AnalyticsService } from '../services/analyticsService.js';
import { Session } from '../models/session.model.js';
import mongoose from 'mongoose';

/**
 * Get user statistics and analytics
 */
export const getUserAnalytics = async (req, res) => {
    try {
        const userId = req.id;
        const stats = await AnalyticsService.getUserStats(userId);

        return res.status(200).json({
            success: true,
            message: 'User analytics retrieved successfully',
            data: stats
        });
    } catch (error) {
        console.error('[getUserAnalytics]', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving analytics'
        });
    }
};

/**
 * Get session-specific analytics
 */
export const getSessionAnalytics = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid session ID'
            });
        }

        const session = await Session.findById(sessionId).select('user').lean();
        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized access to this session'
            });
        }

        const analytics = await AnalyticsService.getSessionAnalytics(sessionId);


        return res.status(200).json({
            success: true,
            message: 'Session analytics retrieved successfully',
            data: analytics
        });
    } catch (error) {
        console.error('[getSessionAnalytics]', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Error retrieving session analytics'
        });
    }
};

/**
 * Get trending topics
 */
export const getTrendingTopics = async (req, res) => {
    try {
        const { limit = 10 } = req.query;
        const topics = await AnalyticsService.getTrendingTopics(parseInt(limit));

        return res.status(200).json({
            success: true,
            message: 'Trending topics retrieved successfully',
            count: topics.length,
            data: { topics }
        });
    } catch (error) {
        console.error('[getTrendingTopics]', error);
        return res.status(500).json({
            success: false,
            message: 'Error retrieving trending topics'
        });
    }
};
