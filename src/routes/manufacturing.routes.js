import express from "express";
import * as c from "../controllers/manufacturing.controller.js";

const router = express.Router();

router.route("/suppliers").get(c.suppliers.list).post(c.suppliers.create);
router.route("/suppliers/:id").put(c.suppliers.update).delete(c.suppliers.remove);

router.route("/warehouses").get(c.warehouses.list).post(c.warehouses.create);
router.route("/warehouses/:id").put(c.warehouses.update).delete(c.warehouses.remove);

router.route("/items").get(c.items.list).post(c.items.create);
router.route("/items/:id").get(c.items.get).put(c.items.update).delete(c.items.remove);

router.route("/bom").get(c.bom.list).post(c.bom.create);
router.get("/bom/:id/requirements", c.bom.requirements);
router.route("/bom/:id").get(c.bom.get).put(c.bom.update).delete(c.bom.remove);

router.get("/inventory/summary", c.inventory.summary);
router.get("/inventory/batches", c.inventory.batches);
router.get("/inventory/movements", c.inventory.movements);
router.get("/inventory/trace/:batchNo", c.inventory.trace);
router.post("/inventory/receive", c.inventory.receive);
router.post("/inventory/transfer", c.inventory.transfer);
router.post("/inventory/adjust", c.inventory.adjust);

router.get("/production/plan", c.production.plan);
router.route("/production").get(c.production.list).post(c.production.create);
router.post("/production/:id/start", c.production.start);
router.post("/production/:id/complete", c.production.complete);
router.post("/production/:id/cancel", c.production.cancel);
router.route("/production/:id").get(c.production.get).put(c.production.update).delete(c.production.remove);

router.route("/orders").get(c.orders.list).post(c.orders.create);
router.post("/orders/:id/dispatch", c.orders.dispatch);
router.post("/orders/:id/cancel", c.orders.cancel);
router.route("/orders/:id").get(c.orders.get).put(c.orders.update);

router.get("/reports/:type", c.reports.get);
router.get("/dashboard", c.dashboard);

export default router;








// import { Router } from "express";
// import { protect } from "../middlewares/auth.middleware.js";
// import { authorize } from "../middlewares/role.middleware.js";
// import * as c from "../controllers/manufacturing.controller.js";

// const router = Router();

// router.use(protect, authorize("admin"));

// router.get("/dashboard", c.dashboard);

// router.route("/suppliers").get(c.listSuppliers).post(c.createSupplier);
// router
//   .route("/suppliers/:id")
//   .get(c.getSupplier)
//   .put(c.updateSupplier)
//   .delete(c.deleteSupplier);

// router.route("/customers").get(c.listCustomers).post(c.createCustomer);
// router
//   .route("/customers/:id")
//   .get(c.getCustomer)
//   .put(c.updateCustomer)
//   .delete(c.deleteCustomer);

// router.route("/items").get(c.listItems).post(c.createItem);
// router
//   .route("/items/:id")
//   .get(c.getItem)
//   .put(c.updateItem)
//   .delete(c.deleteItem);

// router.route("/boms").get(c.listBoms).post(c.createBom);
// router.route("/boms/:id").put(c.updateBom).delete(c.deleteBom);

// router.route("/purchases").get(c.listPurchases).post(c.createPurchase);
// router.route("/purchases/:id").get(c.getPurchase).put(c.updatePurchase);
// router.post("/purchases/:id/receive", c.receivePurchase);
// router.post("/purchases/:id/cancel", c.cancelPurchase);
// router.post("/purchases/:id/payments", c.addPurchasePayment);

// router.get("/production/plan", c.productionPlan);
// router.route("/production").get(c.listProduction).post(c.createProduction);
// router
//   .route("/production/:id")
//   .get(c.getProduction)
//   .put(c.updateProduction)
//   .delete(c.deleteProduction);
// router.post("/production/:id/start", c.startProduction);
// router.post("/production/:id/complete", c.completeProduction);
// router.post("/production/:id/cancel", c.cancelProduction);

// router.route("/orders").get(c.listOrders).post(c.createOrder);
// router.route("/orders/:id").get(c.getOrder).put(c.updateOrder);
// router.post("/orders/:id/dispatch", c.dispatchOrder);
// router.post("/orders/:id/deliver", c.deliverOrder);
// router.post("/orders/:id/cancel", c.cancelOrder);
// router.post("/orders/:id/payments", c.addOrderPayment);

// router.get("/stock", c.stockSummary);
// router.get("/stock/movements", c.stockMovements);
// router.post("/stock/adjust", c.adjustStock);

// export default router;