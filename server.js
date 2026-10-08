import env from "./src/config/env.js";
import connectDB from "./src/config/db.js";
import app from "./src/app.js";
import { seedAdmin } from "./src/services/auth.service.js";


const startServer = async () => {
  await connectDB();
await seedAdmin(); // <- ye add kar


  app.listen(env.PORT, () => {
    console.log(`Server running on port ${env.PORT} (${env.NODE_ENV})`);
  });
};

startServer();