import { Router } from "express";
import { importadexClientController } from "../../controllers/importadex/importadex-client.controller";
import { importadexController } from "../../controllers/importadex/importadex.controller";
import { requireImportadexAdmin } from "../../middlewares/importadexAdmin";
import { processFile } from "../../middlewares/processFiles";

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
router.get("/operations/:id/attachments", importadexController.listOperationAttachments);
router.post("/operations/:id/attachments", processFile, importadexController.uploadOperationAttachments);
router.post("/attachments/upload", processFile, importadexController.uploadOperationAttachments);

router.post("/clients/register", processFile, importadexClientController.register);
router.get("/clients", requireImportadexAdmin, importadexClientController.list);
router.get("/clients/:id", requireImportadexAdmin, importadexClientController.get);
router.patch("/clients/:id/approve", requireImportadexAdmin, importadexClientController.approve);
router.patch("/clients/:id/reject", requireImportadexAdmin, importadexClientController.reject);

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
