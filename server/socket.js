import mongoose from "mongoose";
import { Server } from "socket.io";
import Canteen from "./models/canteen.model.js";
import { userFromToken } from "./middlewares/auth.middleware.js";
import { roleOf } from "./middlewares/canteen.middleware.js";
import { forStudent, forKitchen } from "./utils/views.js";

let io = null;

// Rooms: user:<id> gets that student's order updates, kitchen:<canteenId> gets every order
// for the board, menu:<canteenId> hears that stock or slots changed so open menus refresh.
export const emitOrder = (order) => {
  io?.to(`user:${order.user}`).emit("order", forStudent(order));
  io?.to(`kitchen:${order.canteen}`).emit("order", forKitchen(order));
};

export const emitMenu = (canteenId) => io?.to(`menu:${canteenId}`).emit("menu");

export const emitKitchen = (canteenId, event, data) => io?.to(`kitchen:${canteenId}`).emit(event, data);

export const resetKitchen = (canteenId) => {
  const room = `kitchen:${canteenId}`;
  // Team changes must re-check access for tabs that are already watching.
  io?.to(room).emit("rewatch");
  io?.in(room).socketsLeave(room);
};

const switchRoom = (socket, prefix, room) => {
  for (const joined of socket.rooms) {
    if (joined.startsWith(prefix)) socket.leave(joined);
  }
  socket.join(room);
};

export const initSocket = (server, origins) => {
  io = new Server(server, { cors: { origin: origins } });

  // Signed-in tabs send a 2-minute token from GET /api/auth/socket-token. Without one the
  // socket is anonymous, which is enough to watch a public menu.
  io.use((socket, next) => {
    userFromToken(socket.handshake.auth?.token, "socket")
      .then((user) => {
        socket.data.user = user;
        next();
      })
      .catch(() => next());
  });

  io.on("connection", (socket) => {
    const { user } = socket.data;
    if (user) socket.join(`user:${user._id}`);

    socket.on("watch-menu", (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      if (!mongoose.isValidObjectId(payload?.canteenId)) return reply({ ok: false });
      switchRoom(socket, "menu:", `menu:${payload.canteenId}`);
      reply({ ok: true });
    });

    socket.on("watch-kitchen", async (payload, ack) => {
      const reply = typeof ack === "function" ? ack : () => {};
      try {
        const canteen = mongoose.isValidObjectId(payload?.canteenId) ? await Canteen.findById(payload.canteenId) : null;
        if (!canteen || !roleOf(canteen, user?._id)) return reply({ ok: false });
        switchRoom(socket, "kitchen:", `kitchen:${canteen._id}`);
        reply({ ok: true });
      } catch (error) {
        console.error(error);
        reply({ ok: false });
      }
    });
  });
};
