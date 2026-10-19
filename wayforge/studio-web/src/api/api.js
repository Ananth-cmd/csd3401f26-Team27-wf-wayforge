/*!
 * \file api.js
 * \brief picks the mock or the real backend. pages only import from here.
 *
 * set VITE_API_URL in .env.local to use the real server, otherwise the
 * mock one is used (see .env.example)
 *
 * \author Katie Lim
 */
import { mockApi } from "./mockApi.js";
import { realApi } from "./realApi.js";

export const api = import.meta.env.VITE_API_URL ? realApi : mockApi;
