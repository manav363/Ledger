import http from "node:http";
import { createApp } from "./http/app.js";
import { attachWs } from "./http/wsServer.js";
import { startLiveEvents } from "./http/liveEvents.js";

const port = Number(process.env.PORT ?? 3001);

const server = http.createServer(createApp());
attachWs(server);
startLiveEvents();

server.listen(port, () => {
  console.log(`Ledger API listening on http://localhost:${port}`);
});
