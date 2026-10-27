import { io } from "socket.io-client";
import { api, API_URL } from "./api";

// One connection for the whole app, straight to the API. It can't use the login cookie
// (different domain), so each connect asks for a 2-minute token; logged out, it connects
// anonymously, which is enough to watch a public menu.
export const socket = io(API_URL, {
  autoConnect: false,
  transports: ["websocket", "polling"],
  auth: (send) => {
    api
      .get("/api/auth/socket-token")
      .then(({ token }) => send({ token }))
      .catch(() => send({}));
  },
});

export const reconnectSocket = () => {
  socket.disconnect();
  socket.connect();
};
