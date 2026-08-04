import { Server as HttpServer } from "http";
import { Server } from "socket.io";

const origin =
  process.env.NODE_ENV === "PROD"
    ? process.env.URL_FRONTEND
    : process.env.URL_FRONTEND || "http://localhost:5173";

const allowedOrigins = origin?.split(/[,;\s]+/).filter(Boolean);

const initializeSocket = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: allowedOrigins?.length ? allowedOrigins : true,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    socket.on("importadex:join-operations", () => {
      socket.join("importadex:operations");
    });

    socket.on("importadex:join-client", (clientId: string) => {
      if (clientId) socket.join(`importadex:client:${clientId}`);
    });
  });

  return io;
};

export { initializeSocket };
