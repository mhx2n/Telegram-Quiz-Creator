import { Router, type IRouter } from "express";
import healthRouter from "./health";
import quizzesRouter from "./quizzes";
import telegramRouter from "./telegram";

const router: IRouter = Router();

router.use(healthRouter);
router.use(quizzesRouter);
router.use(telegramRouter);

export default router;
