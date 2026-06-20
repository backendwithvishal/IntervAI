// ============================================
// routes/external.routes.js - External Public API Routes
// ============================================
import express from 'express';
import { AuthMiddleware } from '../middlewares/auth.middleware.js';
import {
    getMotivationalQuote,
    getDailyQuote,
    getAdvice,
    getTriviaQuestions,
    getDefinition,
    getTechNews,
    getRandomPersona,
    getSuggestedActivity
} from '../controllers/externalController.js';

const router = express.Router();

// Motivational quote (Quotable API)
router.get('/quote', AuthMiddleware, getMotivationalQuote);

// Daily inspirational quote (ZenQuotes API)
router.get('/daily-quote', AuthMiddleware, getDailyQuote);

// Random career advice (Advice Slip API)
router.get('/advice', AuthMiddleware, getAdvice);

// Tech trivia quiz (Open Trivia Database)
router.get('/trivia', AuthMiddleware, getTriviaQuestions);

// Dictionary definition lookup (Free Dictionary API)
router.get('/define/:word', AuthMiddleware, getDefinition);

// Top tech news (Hacker News API)
router.get('/tech-news', AuthMiddleware, getTechNews);

// Mock interview personas (Random User API)
router.get('/random-persona', AuthMiddleware, getRandomPersona);

// Suggested prep activity (Bored API)
router.get('/activity', AuthMiddleware, getSuggestedActivity);

export default router;
