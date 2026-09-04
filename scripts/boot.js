// Production boot entrypoint.
// Keep startup deterministic: runtime code is validated in CI rather than rewritten on boot.
require('../server/index.js');
