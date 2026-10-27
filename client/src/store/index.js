import { configureStore } from "@reduxjs/toolkit";
import auth from "./authSlice";
import toasts from "./toastSlice";
import carts, { saveCarts } from "./cartSlice";

export const store = configureStore({ reducer: { auth, toasts, carts } });

let lastCarts = store.getState().carts;
store.subscribe(() => {
  const { carts: next } = store.getState();
  if (next !== lastCarts) saveCarts((lastCarts = next));
});
