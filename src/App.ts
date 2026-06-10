import "dotenv/config";
import express from "express";
import http from "http";
import * as morgan from "morgan";

import cors from "cors";

import { prisma } from "./config/connectionDB";
import router from "./Routes";
import { initializeSocket } from "./Socket";
import path from "path";

const app: express.Application = express();

const server = http.createServer(app);

app.use(cors());

app.use(morgan.default("dev"));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(express.json());

app.use("/api", router);

app.use((req, res) => {
  res.status(404).json({
    message: "Route not found",
  });
});

app.use(
  (
    error: unknown,
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    console.error(error);

    res.status(500).json({
      message: "Internal server error",
    });
  },
);

if (process.env.NODE_ENV === "PROD") {
  app.set("trust proxy", 1);
}

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await prisma.$connect();

    const io = initializeSocket(server);
    app.set("socketio", io);

    server.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    await prisma.$disconnect();
    process.exit(1);
  }
};


const shutdown = async () => {
  console.log("Shutting down server...");

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);


startServer();
