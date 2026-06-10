import { Router } from "express";
import { importadexController } from "../../controllers/importadex/importadex.controller";

const router = Router();

router.get("/operations", importadexController.listOperations);
router.post("/operations", importadexController.createOperation);
router.get("/operations/:id", importadexController.getOperation);
router.patch("/operations/:id", importadexController.updateOperation);
router.patch("/operations/:id/status", importadexController.updateStatus);
router.get("/operations/:id/events", importadexController.listEvents);
router.post("/operations/:id/events", importadexController.createEvent);
router.get("/operations/:id/comments", importadexController.listComments);
router.post("/operations/:id/comments", importadexController.createComment);

for (const key of ["containers", "customs-files", "incidents", "documents", "attachments"] as const) {
  const handlers = importadexController.tableHandlers(key);
  router.get(`/${key}`, handlers.list);
  router.post(`/${key}`, handlers.create);
  router.patch(`/${key}/:id`, handlers.update);
}

router.get("/shipments", (_req, res) => res.json({ ok: true, data: [] }));
router.get("/cargo-items", (_req, res) => res.json({ ok: true, data: [] }));
router.get("/catalogs", importadexController.catalogs);
router.get("/dashboard", importadexController.dashboard);
router.get("/reports", importadexController.reports);

export default router;
