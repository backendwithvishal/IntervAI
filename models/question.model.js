import mongoose from "mongoose";

const questionSchema = new mongoose.Schema({
    session: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Session",
        required: [true, 'Session reference is required'],
        index: true
    },
    question: {
        type: String,
        required: [true, 'Question text is required'],
        trim: true,
        minlength: [5, 'Question must be at least 5 characters long'],
        maxlength: [2000, 'Question cannot exceed 2000 characters']
    },
    answer: {
        type: String,
        required: [true, 'Answer text is required'],
        trim: true,
        minlength: [10, 'Answer must be at least 10 characters long'],
        maxlength: [5000, 'Answer cannot exceed 5000 characters']
    },
    notes: {
        type: String,
        trim: true,
        maxlength: [1000, 'Notes cannot exceed 1000 characters'],
        default: ''
    },
    isPinned: {
        type: Boolean,
        default: false,
        index: true
    },
    difficulty: {
        type: String,
        enum: {
            values: ['easy', 'medium', 'hard'],
            message: '{VALUE} is not a valid difficulty level'
        },
        default: 'medium'
    },
    category: {
        type: String,
        trim: true,
        maxlength: [100, 'Category cannot exceed 100 characters'],
        default: ''
    },
    isAnswered: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Compound index for efficient querying by session, pin status, and date
questionSchema.index({ session: 1, isPinned: -1, createdAt: -1 });

// Additional index for category-based queries
questionSchema.index({ session: 1, category: 1 });

// Virtual to get answer word count
questionSchema.virtual('answerWordCount').get(function () {
    if (!this.answer || typeof this.answer !== 'string') return 0;
    return this.answer.trim().split(/\s+/).filter(word => word.length > 0).length;
});

// Virtual to get question word count
questionSchema.virtual('questionWordCount').get(function () {
    if (!this.question || typeof this.question !== 'string') return 0;
    return this.question.trim().split(/\s+/).filter(word => word.length > 0).length;
});

// Virtual to check if question is long (>100 words)
questionSchema.virtual('isLongQuestion').get(function () {
    return this.questionWordCount > 100;
});

// Virtual to check if answer is comprehensive (>200 words)
questionSchema.virtual('isComprehensiveAnswer').get(function () {
    return this.answerWordCount > 200;
});

// Method to toggle pin status
questionSchema.methods.togglePin = function () {
    this.isPinned = !this.isPinned;
    return this.save();
};

// Method to update answer
questionSchema.methods.updateAnswer = function (newAnswer) {
    if (!newAnswer || typeof newAnswer !== 'string' || newAnswer.trim().length < 10) {
        throw new Error('Answer must be at least 10 characters long');
    }
    this.answer = newAnswer.trim();
    this.isAnswered = true;
    return this.save();
};

// Static method to get questions by difficulty
questionSchema.statics.getByDifficulty = function (sessionId, difficulty) {
    return this.find({
        session: sessionId,
        difficulty: difficulty
    }).sort({ createdAt: -1 });
};

// Static method to get pinned questions
questionSchema.statics.getPinnedQuestions = function (sessionId) {
    return this.find({
        session: sessionId,
        isPinned: true
    }).sort({ createdAt: -1 });
};

// Static method to count questions by session
questionSchema.statics.countBySession = function (sessionId) {
    return this.countDocuments({ session: sessionId });
};

export const Question = mongoose.model("Question", questionSchema);