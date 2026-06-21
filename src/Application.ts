/**
 * This file is the entry point
 */
import config from "@config/index.js"
import { createApp } from "@/lib/express.js"
import { startServer } from "@/lib/http.js"

const app = createApp()
startServer(app, config.app.lib.server)
