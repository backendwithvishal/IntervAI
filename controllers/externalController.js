// ============================================
// controllers/externalController.js - External Public API Handlers
// ============================================
import { ExternalApiService } from '../services/externalApiService.js';

/**
 * GET /api/v1/external/quote
 * Fetch a random motivational quote (Quotable API)
 */
export const getMotivationalQuote = async (req, res) => {
    try {
        const data = await ExternalApiService.fetchMotivationalQuote();

        return res.status(200).json({
            success: true,
            message: 'Motivational quote retrieved successfully',
            data
        });
    } catch (error) {
        console.error('[getMotivationalQuote]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to fetch motivational quote'
        });
    }
};

/**
 * GET /api/v1/external/daily-quote
 * Fetch a daily inspirational quote (ZenQuotes API)
 */
export const getDailyQuote = async (req, res) => {
    try {
        const data = await ExternalApiService.fetchDailyQuote();

        return res.status(200).json({
            success: true,
            message: 'Daily quote retrieved successfully',
            data
        });
    } catch (error) {
        console.error('[getDailyQuote]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to fetch daily quote'
        });
    }
};

/**
 * GET /api/v1/external/advice
 * Fetch random career/life advice (Advice Slip API)
 */
export const getAdvice = async (req, res) => {
    try {
        const data = await ExternalApiService.fetchAdvice();

        return res.status(200).json({
            success: true,
            message: 'Advice retrieved successfully',
            data
        });
    } catch (error) {
        console.error('[getAdvice]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to fetch advice'
        });
    }
};

/**
 * GET /api/v1/external/trivia?amount=5&difficulty=medium&category=18
 * Fetch tech trivia questions (Open Trivia Database)
 * 
 * Query params:
 *   amount (1-50, default 5)
 *   difficulty (easy|medium|hard, default medium)
 *   category (18=CS, 19=Math, default 18)
 */
export const getTriviaQuestions = async (req, res) => {
    try {
        const { amount = 5, difficulty = 'medium', category = 18 } = req.query;

        // Validate difficulty
        if (!['easy', 'medium', 'hard'].includes(difficulty)) {
            return res.status(400).json({
                success: false,
                message: "Invalid difficulty. Use: easy, medium, or hard"
            });
        }

        const parsedAmount = parseInt(amount);
        if (isNaN(parsedAmount) || parsedAmount < 1 || parsedAmount > 50) {
            return res.status(400).json({
                success: false,
                message: "Amount must be a number between 1 and 50"
            });
        }

        const data = await ExternalApiService.fetchTrivia(
            parsedAmount,
            difficulty,
            parseInt(category)
        );

        return res.status(200).json({
            success: true,
            message: `${data.count} trivia questions retrieved successfully`,
            data
        });
    } catch (error) {
        console.error('[getTriviaQuestions]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to fetch trivia questions'
        });
    }
};

/**
 * GET /api/v1/external/define/:word
 * Look up a tech term definition (Free Dictionary API)
 */
export const getDefinition = async (req, res) => {
    try {
        const { word } = req.params;

        if (!word || word.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Word parameter is required"
            });
        }

        if (word.trim().length > 100) {
            return res.status(400).json({
                success: false,
                message: "Word must be less than 100 characters"
            });
        }

        const data = await ExternalApiService.fetchDefinition(word);

        return res.status(200).json({
            success: true,
            message: `Definition for "${word}" retrieved successfully`,
            data
        });
    } catch (error) {
        console.error('[getDefinition]', error);
        const statusCode = error.message.includes('No definition found') ? 404 : 502;
        return res.status(statusCode).json({
            success: false,
            message: error.message || 'Failed to fetch definition'
        });
    }
};

/**
 * GET /api/v1/external/tech-news?limit=10
 * Fetch top technology news (Hacker News API)
 * 
 * Query params:
 *   limit (1-30, default 10)
 */
export const getTechNews = async (req, res) => {
    try {
        const { limit = 10 } = req.query;

        const parsedLimit = parseInt(limit);
        if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 30) {
            return res.status(400).json({
                success: false,
                message: "Limit must be a number between 1 and 30"
            });
        }

        const data = await ExternalApiService.fetchHackerNews(parsedLimit);

        return res.status(200).json({
            success: true,
            message: `${data.count} tech news stories retrieved successfully`,
            data
        });
    } catch (error) {
        console.error('[getTechNews]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to fetch tech news'
        });
    }
};

/**
 * GET /api/v1/external/random-persona?count=1
 * Generate mock interviewer/interviewee personas (Random User API)
 * 
 * Query params:
 *   count (1-10, default 1)
 */
export const getRandomPersona = async (req, res) => {
    try {
        const { count = 1 } = req.query;

        const parsedCount = parseInt(count);
        if (isNaN(parsedCount) || parsedCount < 1 || parsedCount > 10) {
            return res.status(400).json({
                success: false,
                message: "Count must be a number between 1 and 10"
            });
        }

        const data = await ExternalApiService.fetchRandomPersona(parsedCount);

        return res.status(200).json({
            success: true,
            message: `${data.count} persona(s) generated successfully`,
            data
        });
    } catch (error) {
        console.error('[getRandomPersona]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to generate persona'
        });
    }
};

/**
 * GET /api/v1/external/activity
 * Suggest an interview-prep activity (Bored API)
 */
export const getSuggestedActivity = async (req, res) => {
    try {
        const data = await ExternalApiService.fetchActivity();

        return res.status(200).json({
            success: true,
            message: 'Activity suggestion retrieved successfully',
            data
        });
    } catch (error) {
        console.error('[getSuggestedActivity]', error);
        return res.status(502).json({
            success: false,
            message: error.message || 'Failed to fetch activity suggestion'
        });
    }
};
