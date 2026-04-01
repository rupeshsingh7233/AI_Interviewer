import asyncHandler from "express-async-handler";
import Session from "../models/SessionModel.js";
import fetch from "node-fetch";
import fs from "fs";
import FormData from "form-data";
import path from "path";
import mongoose from "mongoose";

const AI_SERVICE_URL = "http://localhost:8000";

const pushSocketUpdate = (io, userId, sessionId, status, message, sessionData) => {
    io.to(userId.toString()).emit("sessionUpdate", {
        sessionId,
        status,
        message,
        sessionData,
    });
}

const createSession = asyncHandler(async (req, res) => {
    const { role, level, interviewType, count } = req.body;
    const userId = req.user._id;
    if (!role || !level || !interviewType || !count) {
        res.status(400);
        throw new Error("Please fill all the fields");
    }
    let session = await Session.create({
        user: userId,
        role,
        level,
        interviewType,
        status: "pending",
    })
    const io = req.app.get("io");

    res.status(202).json({
        message: "Session created successfully",
        sessionId: session._id,
        status: "processing",
    });

    // IIFE -> Immediately Invoked Function Expression
    (async () => {
        try {

            pushSocketUpdate(io, userId, session._id, "ai generating questions",
                `generating ${count} questions for ${level} level ${role} role interview...`);

            const airesponse = await fetch(`${AI_SERVICE_URL}/generate_questions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    role,
                    level,
                    count,
                }),
            });

            if (!airesponse.ok) {
                const errorBody = await airesponse.text();
                throw new Error(`AI service error:${airesponse.status} - ${errorBody}`);
            }
            const aiData = await airesponse.json();
            const codingCount = interviewType === "coding-mix" ? Math.floor(count * 0.2) : 0;

            const questions = aiData.questions.map((question, index) => ({
                questionText: question,
                questionType: index < codingCount ? "coding" : "oral",
                isEvaluated: false,
                isSubmitted: false,
            }));

            session.questions = questions;
            session.status = "in-progress";
            await session.save();

            pushSocketUpdate(io, userId, session._id, "questions ready", "starting interview...");


        } catch (error) {
            console.error(`Session creation failed: ${error.message}`);
            session.status = "failed";
            await session.save();
            pushSocketUpdate(io, userId, session._id, "failed", error.message);
        }
    })();

});

const getSessions = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const sessions = await Session.find({ user: userId }).select("-questions");
    res.status(200).json(sessions);
});

const getSessionById = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const sessionId = req.params.id;
    const session = await Session.findOne({ user: userId, _id: sessionId });
    if (!session) {
        res.status(404);
        throw new Error("Session not found");
    }
    res.status(200).json(session);
});

const deleteSession = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const sessionId = req.params.sessionId;
    const session = await Session.findOne({ user: userId, _id: sessionId });
    if (!session) {
        res.status(404);
        throw new Error("Session not found");
    }
    await session.deleteOne();
    res.status(200).json({ id: sessionId, message: "Session deleted successfully" });
});

const calculateOverallScore = async (sessionId) => {
    const result = await Session.aggregate([
        {
            $match: {
                _id: new mongoose.Types.ObjectId(sessionId),
            },
        },
        {
            $unwind: "$questions",
        },
        {
            $group: {
                _id: '$_id',
                avgTechnicalScore: { $avg: { $cond: [{ $eq: ["$questions.isEvaluated", true] }, "$questions.technicalScore", 0] } },
                avgConfidenceScore: { $avg: { $cond: [{ $eq: ["$questions.isEvaluated", true] }, "$questions.confidenceScore", 0] } },
            },
        },

        {
            $project: {
                _id: 0,
                overallScore: {
                    $round: [
                        { $avg: ["$avgTechnicalScore", "$avgConfidenceScore"] },
                        0
                    ]
                },
                avgTechnical: { $round: ["$avgTechnicalScore", 0] },
                avgConfidence: { $round: ["$avgConfidenceScore", 0] },
            }
        }

    ]);

    return result[0] || { overallScore: 0, avgTechnical: 0, avgConfidence: 0 };
}

const evaluateAnswerAsync = async (io, userId, sessionId, questionInd, audioFilePath = null,
    codeSubmission = null) => {
    const questionIndex = typeof questionInd === "string" ? parseInt(questionInd, 10) : questionInd;

    const session = await Session.findById(sessionId);
    if (!session) {
        pushSocketUpdate(io, userId, sessionId, "failed", "Session not found");
        return;
    }
    const question = session.questions[questionIndex];
    if (!question) {
        pushSocketUpdate(io, userId, sessionId, "failed", `Question not found at index ${questionIndex}`);
        return;
    };

    let transcription = "";
    if (audioFilePath) {
        try {
            pushSocketUpdate(io, userId, sessionId, "AI_TRANSCRIBING", `Transcribing question ${questionIndex + 1}...`);
            const formData = new FormData();
            formData.append("file", fs.createReadStream(audioFilePath));

            const transResponse = await fetch(`${AI_SERVICE_URL}/transcribe`, {
                method: "POST",
                body: formData,
                headers: formData.getHeaders()
            });

            if (!transResponse.ok) {
                const errorBody = await transResponse.text();
                throw new Error(`AI service error:${transResponse.status} - ${errorBody}`);
            }
            const transData = await transResponse.json();
            transcription = transData.transcription || "";

        } catch (error) {
            console.error(`Transcription failed: ${error.message}`);

        }
        finally {
            if (audioFilePath && fs.existsSync(audioFilePath)) {
                fs.unlinkSync(audioFilePath);
            }
        }
    }

    try {
        pushSocketUpdate(io, userId, sessionId, "AI_EVALUATING", `Evaluating question ${questionIndex + 1}...`);
        const evalResponse = await fetch(`${AI_SERVICE_URL}/evaluate`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                question: question.questionText,
                question_Type: question.questionType,
                role: session.role,
                level: session.level,
                user_answer: transcription,
                user_code: codeSubmission || "",
            })
        });
        if (!evalRespone.ok) {
            const errorBody = await evalRespone.text();
            throw new Error(`AI service error:${evalRespone.status} - ${errorBody}`);
        }
        const evalData = await evalRespone.json();

        question.userAnswer = transcription;
        question.userSubmittedCode = code || "";
        question.idealAnswer = evalData.idealAnswer;
        question.aiFeedback = evalData.aiFeedback;
        question.TechnicalScore = evalData.TechnicalScore;
        question.confidenceScore = evalData.confidenceScore;
        question.isEvaluated = true;

        const allQuestionsEvaluated = session.questions.every(q => q.isEvaluated);

        if (session.status === "completed" || allQuestionsEvaluated) {
            const scoreSummary = await calculateOverallScore(sessionId);
            session.overallScore = scoreSummary.overallScore || 0;
            session.metrics = {
                avgTechnical: scoreSummary.avgTechnical,
                avgConfidence: scoreSummary.avgConfidence
            };
            if (allQuestionsEvaluated) {
                session.status = "completed";
                session.completedAt = new Date();
                session.endTime = session.endTime || new Date();
            }
            await session.save();
            pushSocketUpdate(io, userId, sessionId, "Session completed", `Scores finalised`, session);
        }
        else {
            await session.save();
            pushSocketUpdate(io, userId, sessionId, "Evaluation", `Feedback for question ${questionIndex + 1} is ready`, session);
        }


    } catch (error) {
        console.error(`Evaluation failed: ${error.message}`);
        pushSocketUpdate(io, userId, sessionId, "Evaluation failed", error.message, session);
    }

}

const submitAnswer = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const sessionId = req.params.id;
    const { questionIndex, code } = req.body;
    const session = await Session.findOne({ user: userId, _id: sessionId });
    if (!session || session.user.toString() !== userId.toString()) {
        res.status(404);
        throw new Error("Session not found or user unauthorized");
    }
    const questionInd = parseInt(questionIndex, 10);
    const question = session.questions[questionInd];
    if (!question) {
        res.status(404);
        throw new Error(`Question not found at index ${questionIndex}`);
    }
    let audioFilePath = null;
    if (req.file) {
        audioFilePath = path.join(process.cwd(), req.file.path);
    }
    let codeSubmission = code || null


    question.isSubmitted = true;
    await session.save();
    res.status(200).json({
        message: "Answer submitted successfully. Please wait for the result.",
        status: "Received"
    });

    const io = req.app.get("io");
    evaluateAnswerAsync(io, userId, sessionId, questionInd, audioFilePath, codeSubmission);
});

const endSession = asyncHandler(async (req, res) => {
    const userId = req.user._id;
    const sessionId = req.params.id;
    const session = await Session.findById(sessionId);
    if (!session || session.user.toString() !== userId.toString()) {
        res.status(404);
        throw new Error("Session not found or user unauthorized");
    }
    const isProccesing = session.questions.some(q => q.isSubmitted && !q.isEvaluated);
    if (isProccesing) {
        res.status(400);
        throw new Error("Session is still processing,please wait before ending the session");
    }
    if (session.status === "completed") {
        res.status(400);
        throw new Error("Session is already ended");
    }
    const scoreSummary = await calculateOverallScore(sessionId);
    session.overallScore = scoreSummary.overallScore || 0;
    session.metrics = {
        avgTechnicalScore: scoreSummary.avgTechnicalScore,
        avgConfidenceScore: scoreSummary.avgConfidenceScore
    }
    session.status = "completed";
    await session.save();
    const io = req.app.get("io");
    pushSocketUpdate(io, userId, sessionId, "Session completed", `Interview ended early`, session);
    res.status(200).json({ message: "Session ended successfully", session });
});


export { createSession, submitAnswer, endSession, getSessions, getSessionById, deleteSession };
