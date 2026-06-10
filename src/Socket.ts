import { Server as HttpServer } from "http";
import { Server } from "socket.io";

const origin =
  process.env.NODE_ENV === "PROD"
    ? process.env.URL_FRONTEND
    : "http://localhost:5173/";

const initializeSocket = (server: HttpServer) => {
  const io = new Server(server, {
    cors: {
      origin: origin,
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    // socket.on("join-private-room", (userEmail: string) => {
    //   socket.join(userEmail);
    // });

    // socket.on("New-Comment", (data) => {
    //   io.emit("Comment-Received", data);
    // });
  });

  return io;
};

export { initializeSocket };