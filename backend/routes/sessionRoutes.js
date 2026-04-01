import express from "express";
import { 
    createSession,
    getSessions,
    getSessionById,
    deleteSession,
    submitAnswer,
    endSession
} from "../controllers/sessionController.js";
import { protect } from "../middleware/authMiddleware.js";
import { uploadSingleAudio } from "../middleware/uploadMiddleware.js";

const router = express.Router();

router.use(protect);

router.route("/").post( createSession );

router.route("/").get(getSessions)

router.route("/:id").get(protect, getSessionById)
                         .delete(protect, deleteSession);

router.route("/:id/submit_answer").post(uploadSingleAudio, submitAnswer);

router.route("/:id/end").post(protect, endSession);


export default router;    