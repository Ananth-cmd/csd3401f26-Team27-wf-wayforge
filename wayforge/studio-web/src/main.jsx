// main.jsx - starts the React app
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { api } from "./api/api.js";
import "./styles.css";

// find out if the backend is running first, so the header shows the right thing
api.ready.then(() => {
  createRoot(document.getElementById("root")).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
