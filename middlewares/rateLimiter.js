import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { getRedisClient } from "../config/redis.js";

const createLimiter = (windowMs, max, message, skipSuccessfulRequests = false) => {
    return rateLimit({
        windowMs,
        max,
        message: { success: false, message },
        standardHeaders: 'draft-7',
        legacyHeaders: false,
        skipSuccessfulRequests,
        skipFailedRequests: false,
        store: new RedisStore({
            sendCommand: async (...args) => {
                const redis = getRedisClient();
                return await redis.call(args[0], ...args.slice(1));
            },
        }),
        handler: (req, res) => {
            res.status(429).json({ success: false, message });
        }
    });
};

export const generalLimiter = createLimiter(
    15 * 60 * 1000,
    100,
    'Too many requests. Try again in 15 minutes',
    false
);

export const questionGenerationLimiter = createLimiter(
    60 * 60 * 1000,
    20,
    'AI generation limit reached. Try again in 1 hour',
    true
);

export const authLimiter = createLimiter(
    15 * 60 * 1000,
    10,
    'Too many login attempts. Try again in 15 minutes',
    true
);

export const togglePinLimiter = createLimiter(
    1 * 60 * 1000,
    30,
    'Too many pin/unpin requests. Slow down',
    true
);

export const exportLimiter = createLimiter(
    10 * 60 * 1000,
    5,
    'Too many export requests. Try again in 10 minutes',
    true
);