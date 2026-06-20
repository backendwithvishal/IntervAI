// ============================================
// controllers/questionController.js
// ============================================
import Groq from "groq-sdk";
import { Session } from "../models/session.model.js";
import { Question } from "../models/question.model.js";
import mongoose from "mongoose";
import { questionQueue } from "../config/queue.js";
import { CacheService } from "../services/cacheService.js";

let groqInstance = null;

const getGroqClient = () => {
    if (groqInstance) return groqInstance;
    
    const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_API;
    
    if (!apiKey || apiKey.trim() === '') {
        console.error('[GROQ] API key missing from environment variables');
        return null;
    }
    
    groqInstance = new Groq({ apiKey: apiKey.trim() });
    return groqInstance;
};

// ============================================
// AI GENERATION FUNCTIONS
// ============================================

export const generateInterviewQuestion = async (req, res) => {
    try {
        const groq = getGroqClient();
        
        if (!groq) {
            return res.status(500).json({
                success: false,
                message: "AI service is not configured. Please add GROQ_API_KEY to your .env file"
            });
        }

        const { role, experience, topicsToFocus, sessionId } = req.body;

        // Validation
        if (!role || !experience || !topicsToFocus || !sessionId) {
            return res.status(400).json({
                success: false,
                message: "Please provide all required fields: role, experience, topicsToFocus, sessionId"
            });
        }

        if (typeof role !== 'string' || role.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Role must be a non-empty string"
            });
        }

        if (typeof experience !== 'string' || experience.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Experience must be a non-empty string"
            });
        }

        if (!Array.isArray(topicsToFocus) || topicsToFocus.length === 0) {
            return res.status(400).json({
                success: false,
                message: "topicsToFocus must be a non-empty array"
            });
        }

        const invalidTopics = topicsToFocus.filter(t => typeof t !== 'string' || t.trim().length === 0);
        if (invalidTopics.length > 0) {
            return res.status(400).json({
                success: false,
                message: "All topics must be non-empty strings"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid session ID format"
            });
        }

        // Database checks
        const session = await Session.findById(sessionId).lean();
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to generate questions for this session"
            });
        }

        const questionCount = await Question.countDocuments({ session: sessionId });
        if (questionCount >= 50) {
            return res.status(400).json({
                success: false,
                message: "Session has reached maximum number of questions (50)",
                currentCount: questionCount
            });
        }

        // Check cache first
        const cacheKey = CacheService.generateKey(role, experience, topicsToFocus);
        const cachedQuestions = await CacheService.get(cacheKey);

        if (cachedQuestions && cachedQuestions.length > 0) {
            const questionsToSave = cachedQuestions.slice(0, 5).map(q => ({
                session: sessionId,
                question: q.question.trim(),
                answer: q.answer.trim(),
                isPinned: false
            }));

            const createdQuestions = await Question.insertMany(questionsToSave);

            await Session.findByIdAndUpdate(
                sessionId,
                { $push: { questions: { $each: createdQuestions.map(q => q._id) } } }
            );

            return res.status(201).json({
                success: true,
                message: `Successfully generated ${createdQuestions.length} questions (from cache)`,
                count: createdQuestions.length,
                cached: true,
                data: { questions: createdQuestions }
            });
        }

        // Add to queue for async processing
        const job = await questionQueue.add({
            role: role.trim(),
            experience: experience.trim(),
            topicsToFocus: topicsToFocus.map(t => t.trim()),
            sessionId,
            userId: req.id,
            cacheKey
        });

        return res.status(202).json({
            success: true,
            message: "Question generation queued. Check status using job ID",
            jobId: job.id,
            checkStatusUrl: `/api/v1/queue/question/${job.id}`,
            estimatedTime: "30-60 seconds"
        });

    } catch (error) {
        console.error('[generateInterviewQuestion]', error);
        return res.status(500).json({
            success: false,
            message: "Error generating interview questions",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const getJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;
        const job = await questionQueue.getJob(jobId);

        if (!job) {
            return res.status(404).json({
                success: false,
                message: "Job not found"
            });
        }

        const state = await job.getState();
        const progress = job.progress();

        if (state === 'completed') {
            const result = job.returnvalue;
            return res.status(200).json({
                success: true,
                status: 'completed',
                message: "Questions generated successfully",
                data: result
            });
        }

        if (state === 'failed') {
            return res.status(200).json({
                success: false,
                status: 'failed',
                message: "Question generation failed",
                error: job.failedReason
            });
        }

        return res.status(200).json({
            success: true,
            status: state,
            progress,
            message: `Job is ${state}`
        });

    } catch (error) {
        console.error('[getJobStatus]', error);
        return res.status(500).json({
            success: false,
            message: "Error retrieving job status",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const regenerateQuestion = async (req, res) => {
    try {
        const groq = getGroqClient();
        
        if (!groq) {
            return res.status(500).json({
                success: false,
                message: "AI service is not configured"
            });
        }

        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid question ID format"
            });
        }

        const question = await Question.findById(id).populate({
            path: 'session',
            select: 'user role experience topicsToFocus'
        });

        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        if (!question.session) {
            return res.status(404).json({
                success: false,
                message: "Session associated with this question not found"
            });
        }

        if (question.session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to regenerate this question"
            });
        }

        const { role, experience, topicsToFocus } = question.session;
        
        if (!role || !experience || !topicsToFocus) {
            return res.status(400).json({
                success: false,
                message: "Session is missing required fields"
            });
        }

        const topicsArray = Array.isArray(topicsToFocus) ? topicsToFocus : [String(topicsToFocus)];
        const topicsString = topicsArray.map(t => String(t).trim()).join(', ');

        const prompt = `You are an expert interview question generator.
Generate exactly 1 interview question for the following role and experience level.

Role: ${role}
Experience Level: ${experience}
Topics to Focus: ${topicsString}

IMPORTANT: Return ONLY a valid JSON array with no additional text, explanations, or markdown formatting.
Each object must have "question" and "answer" fields.

Example format:
[
  {"question": "What is Express.js and why is it used?", "answer": "Express.js is a minimal and flexible Node.js web application framework that provides a robust set of features for web and mobile applications."}
]

Generate 1 high-quality interview question with a detailed answer:`;

        let completion;
        try {
            completion = await groq.chat.completions.create({
                model: "llama-3.1-8b-instant",
                messages: [
                    {
                        role: "system",
                        content: "You are an expert technical interviewer. Generate only valid JSON arrays with no additional formatting or text."
                    },
                    {
                        role: "user",
                        content: prompt
                    }
                ],
                temperature: 0.8,
                max_tokens: 1000,
                stream: false
            });
        } catch (apiError) {
            if (apiError.status === 401) {
                return res.status(500).json({
                    success: false,
                    message: "AI service authentication failed"
                });
            }

            if (apiError.status === 429) {
                return res.status(429).json({
                    success: false,
                    message: "AI service rate limit exceeded"
                });
            }

            return res.status(503).json({
                success: false,
                message: "Failed to connect to AI service"
            });
        }

        let rawText = completion.choices[0]?.message?.content;

        if (!rawText) {
            return res.status(500).json({
                success: false,
                message: "Failed to generate question from AI - empty response"
            });
        }

        rawText = rawText.replace(/```json|```/gi, "").trim();
        const arrayMatch = rawText.match(/\[[\s\S]*\]/);
        
        if (!arrayMatch) {
            return res.status(500).json({
                success: false,
                message: "AI response did not contain a valid JSON array"
            });
        }

        let questionsData;
        try {
            questionsData = JSON.parse(arrayMatch[0]);
        } catch (err) {
            return res.status(500).json({
                success: false,
                message: "Invalid response format from AI model"
            });
        }

        if (!Array.isArray(questionsData) || questionsData.length === 0) {
            return res.status(500).json({
                success: false,
                message: "AI did not return valid question data"
            });
        }

        const data = questionsData[0];
        if (!data || !data.question || !data.answer) {
            return res.status(500).json({
                success: false,
                message: "AI did not return valid question and answer"
            });
        }

        question.question = data.question.trim();
        question.answer = data.answer.trim();
        await question.save();

        return res.status(200).json({
            success: true,
            message: "Question regenerated successfully",
            data: { question }
        });

    } catch (error) {
        console.error('[regenerateQuestion]', error);
        return res.status(500).json({
            success: false,
            message: "Error regenerating question",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ============================================
// QUERY FUNCTIONS
// ============================================

export const getQuestionsBySession = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid session ID format"
            });
        }

        const session = await Session.findById(sessionId).select('user').lean();
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to view these questions"
            });
        }

        const questions = await Question.find({ session: sessionId })
            .sort({ createdAt: 1 })
            .lean();

        return res.status(200).json({
            success: true,
            message: "Questions retrieved successfully",
            count: questions.length,
            data: { questions }
        });

    } catch (error) {
        console.error('[getQuestionsBySession]', error);
        return res.status(500).json({
            success: false,
            message: "Error retrieving questions",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const getQuestionById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid question ID format"
            });
        }

        const question = await Question.findById(id).populate({
            path: 'session',
            select: 'user role experience topicsToFocus'
        });

        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        if (!question.session || question.session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to view this question"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Question retrieved successfully",
            data: { question }
        });

    } catch (error) {
        console.error('[getQuestionById]', error);
        return res.status(500).json({
            success: false,
            message: "Error retrieving question",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const searchQuestions = async (req, res) => {
    try {
        const { q, limit = 20 } = req.query;

        if (!q || q.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Please provide a search query (q parameter)"
            });
        }

        const userSessions = await Session.find({ user: req.id }).select('_id').lean();
        const sessionIds = userSessions.map(s => s._id);

        if (sessionIds.length === 0) {
            return res.status(200).json({
                success: true,
                message: "No sessions found for user",
                count: 0,
                data: { questions: [] }
            });
        }

        const questions = await Question.find({
            session: { $in: sessionIds },
            $or: [
                { question: { $regex: q.trim(), $options: 'i' } },
                { answer: { $regex: q.trim(), $options: 'i' } }
            ]
        })
        .populate({
            path: 'session',
            select: 'role experience topicsToFocus'
        })
        .limit(Math.min(parseInt(limit), 100))
        .sort({ createdAt: -1 })
        .lean();

        return res.status(200).json({
            success: true,
            message: "Search completed successfully",
            count: questions.length,
            data: { 
                questions,
                searchQuery: q
            }
        });

    } catch (error) {
        console.error('[searchQuestions]', error);
        return res.status(500).json({
            success: false,
            message: "Error searching questions",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const getPinnedQuestions = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid session ID format"
            });
        }

        const session = await Session.findById(sessionId).select('user').lean();
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to view these questions"
            });
        }

        const questions = await Question.find({ 
            session: sessionId,
            isPinned: true 
        })
        .sort({ createdAt: -1 })
        .lean();

        return res.status(200).json({
            success: true,
            message: "Pinned questions retrieved successfully",
            count: questions.length,
            data: { questions }
        });

    } catch (error) {
        console.error('[getPinnedQuestions]', error);
        return res.status(500).json({
            success: false,
            message: "Error retrieving pinned questions",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const getQuestionStats = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid session ID format"
            });
        }

        const session = await Session.findById(sessionId)
            .select('user role experience topicsToFocus')
            .lean();
            
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to view these statistics"
            });
        }

        const [totalQuestions, pinnedQuestions] = await Promise.all([
            Question.countDocuments({ session: sessionId }),
            Question.countDocuments({ session: sessionId, isPinned: true })
        ]);

        return res.status(200).json({
            success: true,
            message: "Statistics retrieved successfully",
            data: {
                stats: {
                    total: totalQuestions,
                    pinned: pinnedQuestions,
                    unpinned: totalQuestions - pinnedQuestions
                },
                session: {
                    role: session.role,
                    experience: session.experience,
                    topics: session.topicsToFocus
                }
            }
        });

    } catch (error) {
        console.error('[getQuestionStats]', error);
        return res.status(500).json({
            success: false,
            message: "Error retrieving statistics",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ============================================
// CREATE FUNCTIONS
// ============================================

export const addCustomQuestion = async (req, res) => {
    try {
        const { sessionId, question, answer } = req.body;

        if (!sessionId || !question || !answer) {
            return res.status(400).json({
                success: false,
                message: "Please provide sessionId, question, and answer"
            });
        }

        if (typeof question !== 'string' || question.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Question must be a non-empty string"
            });
        }

        if (typeof answer !== 'string' || answer.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: "Answer must be a non-empty string"
            });
        }

        if (!mongoose.Types.ObjectId.isValid(sessionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid session ID format"
            });
        }

        const session = await Session.findById(sessionId);
        if (!session) {
            return res.status(404).json({
                success: false,
                message: "Session not found"
            });
        }

        if (session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to add questions to this session"
            });
        }

        const questionCount = await Question.countDocuments({ session: sessionId });
        if (questionCount >= 50) {
            return res.status(400).json({
                success: false,
                message: "Session has reached maximum number of questions (50)",
                currentCount: questionCount
            });
        }

        const newQuestion = await Question.create({
            session: sessionId,
            question: question.trim(),
            answer: answer.trim(),
            isPinned: false
        });

        await Session.findByIdAndUpdate(
            sessionId,
            { $push: { questions: newQuestion._id } }
        );

        return res.status(201).json({
            success: true,
            message: "Custom question added successfully",
            data: { question: newQuestion }
        });

    } catch (error) {
        console.error('[addCustomQuestion]', error);
        return res.status(500).json({
            success: false,
            message: "Error adding custom question",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// UPDATE QUESTION FUNCTIONS

export const updateQuestion = async (req, res) => {
    try {
        const { id } = req.params;
        const { question, answer } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid question ID format"
            });
        }

        if (!question && !answer) {
            return res.status(400).json({
                success: false,
                message: "Please provide at least one field to update (question or answer)"
            });
        }

        if (question && (typeof question !== 'string' || question.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                message: "Question must be a non-empty string"
            });
        }

        if (answer && (typeof answer !== 'string' || answer.trim().length === 0)) {
            return res.status(400).json({
                success: false,
                message: "Answer must be a non-empty string"
            });
        }

        const existingQuestion = await Question.findById(id).populate({
            path: 'session',
            select: 'user'
        });

        if (!existingQuestion) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        if (!existingQuestion.session || existingQuestion.session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to update this question"
            });
        }

        if (question) existingQuestion.question = question.trim();
        if (answer) existingQuestion.answer = answer.trim();

        await existingQuestion.save();

        return res.status(200).json({
            success: true,
            message: "Question updated successfully",
            data: { question: existingQuestion }
        });

    } catch (error) {
        console.error('[updateQuestion]', error);
        return res.status(500).json({
            success: false,
            message: "Error updating question",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

export const togglePinQuestion = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid question ID format"
            });
        }

        const question = await Question.findById(id).populate({
            path: 'session',
            select: 'user'
        });

        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        if (!question.session) {
            return res.status(404).json({
                success: false,
                message: "Session associated with this question not found"
            });
        }

        if (question.session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to modify this question"
            });
        }

        question.isPinned = !question.isPinned;
        await question.save();

        return res.status(200).json({
            success: true,
            message: `Question ${question.isPinned ? 'pinned' : 'unpinned'} successfully`,
            data: { 
                isPinned: question.isPinned,
                question 
            }
        });

    } catch (error) {
        console.error('[togglePinQuestion]', error);
        return res.status(500).json({
            success: false,
            message: "Error toggling pin status",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ============================================
// DELETE FUNCTIONS
// ============================================

export const deleteQuestion = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid question ID format"
            });
        }

        const question = await Question.findById(id).populate({
            path: 'session',
            select: 'user'
        });

        if (!question) {
            return res.status(404).json({
                success: false,
                message: "Question not found"
            });
        }

        if (!question.session || question.session.user.toString() !== req.id) {
            return res.status(403).json({
                success: false,
                message: "You don't have permission to delete this question"
            });
        }

        await Session.findByIdAndUpdate(
            question.session._id,
            { $pull: { questions: id } }
        );

        await Question.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: "Question deleted successfully",
            data: { deletedId: id }
        });

    } catch (error) {
        console.error('[deleteQuestion]', error);
        return res.status(500).json({
            success: false,
            message: "Error deleting question",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};