import * as assetService from "../services/asset.service.js";

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const createAsset = asyncHandler(async (req, res) => {
  const data = await assetService.createAsset(req.body);
  res.status(201).json({ success: true, message: "Asset add ho gaya", data });
});

export const getAssets = asyncHandler(async (req, res) => {
  const data = await assetService.getAssets(req.query);
  res.json({ success: true, data });
});

export const getSummary = asyncHandler(async (req, res) => {
  const data = await assetService.getSummary();
  res.json({ success: true, data });
});

export const getAssetById = asyncHandler(async (req, res) => {
  const data = await assetService.getAssetById(req.params.id);
  res.json({ success: true, data });
});

export const updateAsset = asyncHandler(async (req, res) => {
  const data = await assetService.updateAsset(req.params.id, req.body);
  res.json({ success: true, message: "Asset update ho gaya", data });
});

export const deleteAsset = asyncHandler(async (req, res) => {
  await assetService.deleteAsset(req.params.id);
  res.json({ success: true, message: "Asset delete ho gaya" });
});

export const assignAsset = asyncHandler(async (req, res) => {
  const data = await assetService.assignAsset(req.params.id, req.body);
  res.json({ success: true, message: "Asset assign ho gaya", data });
});

export const returnAsset = asyncHandler(async (req, res) => {
  const data = await assetService.returnAsset(req.params.id, req.body);
  res.json({ success: true, message: "Asset return ho gaya", data });
});

export const changeStatus = asyncHandler(async (req, res) => {
  const data = await assetService.changeStatus(req.params.id, req.body.status);
  res.json({ success: true, message: "Status update ho gaya", data });
});