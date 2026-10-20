/** Holds the running room manager so HTTP controllers (admin dashboard) read the SAME in-memory rooms the sockets use. */
let manager = null;
module.exports = {
  set(m) { manager = m; },
  get() { return manager; },
  clear() { manager = null; },
};
