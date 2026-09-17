const values = new Map();
const localStorage = {
  getItem(key) {
    return values.has(String(key)) ? values.get(String(key)) : null;
  },
  setItem(key, value) {
    values.set(String(key), String(value));
  },
  removeItem(key) {
    values.delete(String(key));
  },
  clear() {
    values.clear();
  },
};

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  writable: true,
  value: localStorage,
});
