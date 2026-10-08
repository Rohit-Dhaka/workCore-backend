import { v2 as cloudinary } from "cloudinary";
import env from "../config/env.js";

cloudinary.config({
  cloud_name: env.CLOUD_NAME,
  api_key: env.API_KEY,
  api_secret: env.API_SECRET,
});


export const uploadToCloudinary = (
  buffer,
  folder = "erp/employees"
) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        folder,
        resource_type: "image",
      },
      (error, result) => {
        if (error) {
          return reject(error);
        }

        resolve({
          url: result.secure_url,
          publicId: result.public_id,
        });
      }
    );

    uploadStream.end(buffer);
  });
};


export const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return null;

  return await cloudinary.uploader.destroy(publicId, {
    resource_type: "image",
  });
};

export default cloudinary;