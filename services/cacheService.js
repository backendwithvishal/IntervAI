// ============================================
// services/cacheService.js
// ============================================
import { getRedisClient } from '../config/redis.js';
import crypto from 'crypto';

const CACHE_TTL = 3600; // 1 hour

export class CacheService {
    static generateKey(role, experience, topics) {
        const normalized = `${role}:${experience}:${[...topics].sort().join(',')}`.toLowerCase();
        return crypto.createHash('md5').update(normalized).digest('hex');
    }

    static async get(key) {
        try {
            const redis = getRedisClient();
            const cached = await redis.get(`questions:${key}`);
            return cached ? JSON.parse(cached) : null;
        } catch (error) {
            console.error('[Cache Get Error]', error);
            return null;
        }
    }

    static async set(key, value) {
        try {
            const redis = getRedisClient();
            await redis.setex(`questions:${key}`, CACHE_TTL, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error('[Cache Set Error]', error);
            return false;
        }
    }

    static async invalidate(pattern) {
        try {
            const redis = getRedisClient();
            const keys = await redis.keys(`questions:${pattern}*`);
            if (keys.length > 0) {
                await redis.del(...keys);
            }
            return true;
        } catch (error) {
            console.error('[Cache Invalidate Error]', error);
            return false;
        }
    }
}