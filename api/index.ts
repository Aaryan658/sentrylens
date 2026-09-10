// Vercel serverless entry. The Express app already guards its own
// `app.listen()` to entrypoint-only, so importing it here is inert; Vercel
// invokes the exported handler directly.
//
// Routes are exposed at the app's own paths ("/health", "/agent/step") via the
// rewrites in vercel.json, which forward those paths to this single function.
import { app } from "../server/src/index.js";

export default app;
