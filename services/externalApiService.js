// ============================================
// services/externalApiService.js - External Public API Client
// ============================================

const DEFAULT_TIMEOUT = 10000; // 10 seconds

/**
 * Generic fetch wrapper with timeout and error handling
 */
const fetchWithTimeout = async (url, options = {}, timeout = DEFAULT_TIMEOUT) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal,
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'IntervAI/1.0',
                ...options.headers
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const contentType = response.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            return await response.json();
        }

        // Some APIs return JSON without proper content-type
        const text = await response.text();
        try {
            return JSON.parse(text);
        } catch {
            return { raw: text };
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request to ${url} timed out after ${timeout}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
};

/**
 * External API Service
 * Aggregates multiple free, no-auth public APIs for interview preparation features
 */
export class ExternalApiService {
    /**
     * Fetch a random motivational/inspirational quote from Quotable API
     * API: https://github.com/lukePeavey/quotable
     * @returns {Promise<Object>} Quote with content, author, and tags
     */
    static async fetchMotivationalQuote() {
        try {
            const data = await fetchWithTimeout('https://api.quotable.io/random');
            return {
                quote: data.content,
                author: data.author,
                tags: data.tags || [],
                length: data.length,
                source: 'Quotable API'
            };
        } catch (error) {
            console.error('[ExternalAPI] Quotable error:', error.message);
            throw new Error('Failed to fetch motivational quote');
        }
    }

    /**
     * Fetch daily inspirational quote from ZenQuotes API
     * API: https://zenquotes.io/
     * @returns {Promise<Object>} Quote with text and author
     */
    static async fetchDailyQuote() {
        try {
            const data = await fetchWithTimeout('https://zenquotes.io/api/random');
            if (!Array.isArray(data) || data.length === 0) {
                throw new Error('Empty response from ZenQuotes');
            }
            const quote = data[0];
            return {
                quote: quote.q,
                author: quote.a,
                html: quote.h || null,
                source: 'ZenQuotes API'
            };
        } catch (error) {
            console.error('[ExternalAPI] ZenQuotes error:', error.message);
            throw new Error('Failed to fetch daily quote');
        }
    }

    /**
     * Fetch random advice from Advice Slip API
     * API: https://api.adviceslip.com/
     * @returns {Promise<Object>} Advice slip with id and text
     */
    static async fetchAdvice() {
        try {
            const data = await fetchWithTimeout('https://api.adviceslip.com/advice');
            return {
                id: data.slip?.id,
                advice: data.slip?.advice,
                source: 'Advice Slip API'
            };
        } catch (error) {
            console.error('[ExternalAPI] Advice Slip error:', error.message);
            throw new Error('Failed to fetch advice');
        }
    }

    /**
     * Fetch trivia questions from Open Trivia Database
     * API: https://opentdb.com/
     * @param {number} amount - Number of questions (1-50)
     * @param {string} difficulty - easy | medium | hard
     * @param {number} category - Category ID (18 = Computer Science, 19 = Math)
     * @returns {Promise<Object>} Array of trivia questions
     */
    static async fetchTrivia(amount = 5, difficulty = 'medium', category = 18) {
        try {
            const url = new URL('https://opentdb.com/api.php');
            url.searchParams.set('amount', Math.min(Math.max(1, amount), 50));
            url.searchParams.set('category', category);
            url.searchParams.set('difficulty', difficulty);
            url.searchParams.set('type', 'multiple');

            const data = await fetchWithTimeout(url.toString());

            if (data.response_code !== 0) {
                const errorMessages = {
                    1: 'Not enough questions available for this category/difficulty',
                    2: 'Invalid parameter in request',
                    3: 'Token not found',
                    4: 'All questions exhausted for this session',
                    5: 'Rate limit exceeded, try again later'
                };
                throw new Error(errorMessages[data.response_code] || 'Unknown error from trivia API');
            }

            return {
                count: data.results.length,
                questions: data.results.map(q => ({
                    category: q.category,
                    difficulty: q.difficulty,
                    question: q.question,
                    correctAnswer: q.correct_answer,
                    incorrectAnswers: q.incorrect_answers,
                    allAnswers: [q.correct_answer, ...q.incorrect_answers].sort(() => Math.random() - 0.5)
                })),
                source: 'Open Trivia Database'
            };
        } catch (error) {
            console.error('[ExternalAPI] Trivia error:', error.message);
            throw new Error(`Failed to fetch trivia: ${error.message}`);
        }
    }

    /**
     * Fetch word definition from Free Dictionary API
     * API: https://dictionaryapi.dev/
     * @param {string} word - Word to look up
     * @returns {Promise<Object>} Word definition with meanings and phonetics
     */
    static async fetchDefinition(word) {
        try {
            const sanitizedWord = encodeURIComponent(word.trim().toLowerCase());
            const data = await fetchWithTimeout(
                `https://api.dictionaryapi.dev/api/v2/entries/en/${sanitizedWord}`
            );

            if (!Array.isArray(data) || data.length === 0) {
                throw new Error(`No definition found for "${word}"`);
            }

            const entry = data[0];
            return {
                word: entry.word,
                phonetic: entry.phonetic || null,
                phonetics: (entry.phonetics || []).filter(p => p.audio).map(p => ({
                    text: p.text,
                    audio: p.audio
                })),
                meanings: (entry.meanings || []).map(m => ({
                    partOfSpeech: m.partOfSpeech,
                    definitions: (m.definitions || []).slice(0, 3).map(d => ({
                        definition: d.definition,
                        example: d.example || null,
                        synonyms: (d.synonyms || []).slice(0, 5)
                    })),
                    synonyms: (m.synonyms || []).slice(0, 5),
                    antonyms: (m.antonyms || []).slice(0, 5)
                })),
                sourceUrls: entry.sourceUrls || [],
                source: 'Free Dictionary API'
            };
        } catch (error) {
            console.error('[ExternalAPI] Dictionary error:', error.message);
            throw new Error(`Failed to fetch definition: ${error.message}`);
        }
    }

    /**
     * Fetch top tech news from Hacker News API
     * API: https://github.com/HackerNews/API
     * @param {number} limit - Number of stories to fetch (1-30)
     * @returns {Promise<Object>} Array of top stories
     */
    static async fetchHackerNews(limit = 10) {
        try {
            const topIds = await fetchWithTimeout(
                'https://hacker-news.firebaseio.com/v0/topstories.json'
            );

            if (!Array.isArray(topIds) || topIds.length === 0) {
                throw new Error('No stories available');
            }

            const storyIds = topIds.slice(0, Math.min(Math.max(1, limit), 30));

            const stories = await Promise.allSettled(
                storyIds.map(id =>
                    fetchWithTimeout(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {}, 5000)
                )
            );

            const validStories = stories
                .filter(r => r.status === 'fulfilled' && r.value)
                .map(r => ({
                    id: r.value.id,
                    title: r.value.title,
                    url: r.value.url || null,
                    score: r.value.score,
                    author: r.value.by,
                    commentCount: r.value.descendants || 0,
                    time: new Date(r.value.time * 1000).toISOString(),
                    hnUrl: `https://news.ycombinator.com/item?id=${r.value.id}`
                }));

            return {
                count: validStories.length,
                stories: validStories,
                source: 'Hacker News API'
            };
        } catch (error) {
            console.error('[ExternalAPI] Hacker News error:', error.message);
            throw new Error('Failed to fetch tech news');
        }
    }

    /**
     * Generate random mock interview persona using Random User API
     * API: https://randomuser.me/
     * @param {number} count - Number of personas (1-10)
     * @returns {Promise<Object>} Random user personas
     */
    static async fetchRandomPersona(count = 1) {
        try {
            const safeCount = Math.min(Math.max(1, count), 10);
            const data = await fetchWithTimeout(
                `https://randomuser.me/api/?results=${safeCount}&inc=name,email,picture,location,phone,nat`
            );

            if (!data.results || data.results.length === 0) {
                throw new Error('No personas generated');
            }

            return {
                count: data.results.length,
                personas: data.results.map(user => ({
                    name: `${user.name.first} ${user.name.last}`,
                    title: user.name.title,
                    email: user.email,
                    phone: user.phone,
                    location: {
                        city: user.location.city,
                        state: user.location.state,
                        country: user.location.country
                    },
                    avatar: user.picture.large,
                    thumbnail: user.picture.thumbnail,
                    nationality: user.nat
                })),
                source: 'Random User API'
            };
        } catch (error) {
            console.error('[ExternalAPI] Random User error:', error.message);
            throw new Error('Failed to generate persona');
        }
    }

    /**
     * Fetch a suggested activity for interview prep downtime
     * API: https://bored-api.appbrewery.com/
     * @returns {Promise<Object>} Suggested activity
     */
    static async fetchActivity() {
        try {
            const data = await fetchWithTimeout('https://bored-api.appbrewery.com/api/activity');
            return {
                activity: data.activity,
                type: data.type,
                participants: data.participants,
                price: data.price,
                accessibility: data.accessibility,
                key: data.key,
                source: 'Bored API'
            };
        } catch (error) {
            console.error('[ExternalAPI] Bored API error:', error.message);
            throw new Error('Failed to fetch activity suggestion');
        }
    }
}
