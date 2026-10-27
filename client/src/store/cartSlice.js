import { createSlice } from "@reduxjs/toolkit";

// One cart per canteen: { [canteenId]: { [itemId]: qty } }. Kept in localStorage so a
// refresh or a login detour doesn't empty it.
const KEY = "agla-carts";
const load = () => {
  try {
    return JSON.parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
};

const cartSlice = createSlice({
  name: "carts",
  initialState: load(),
  reducers: {
    setQty: (state, action) => {
      const { canteenId, itemId, qty } = action.payload;
      const cart = (state[canteenId] ??= {});
      if (qty <= 0) delete cart[itemId];
      else cart[itemId] = Math.min(qty, 10);
    },
    clearCart: (state, action) => {
      delete state[action.payload];
    },
  },
});

export const saveCarts = (carts) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(carts));
  } catch {
    // Private mode or full storage: the cart just won't survive a refresh.
  }
};

export const { setQty, clearCart } = cartSlice.actions;
export default cartSlice.reducer;
