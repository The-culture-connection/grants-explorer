import { Router, type IRouter } from "express";
import healthRouter from "./health";
import grantsRouter from "./grants";

const router: IRouter = Router();

router.use(healthRouter);
router.use(grantsRouter);

export default router;
