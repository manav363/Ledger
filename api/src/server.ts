import { createApp } from "./http/app.js";

const port = Number(process.env.PORT ?? 3001);
createApp().listen(port, () => {
  console.log(`Ledger API listening on http://localhost:${port}`);
});
