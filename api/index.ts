import { app } from "../server/app";

// Vercel runs this as the API function: every /api/* request is rewritten here (see vercel.json)
// and Express routes it with the original path.
export default app;
