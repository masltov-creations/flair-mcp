import pino from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: config.logLevel,
  ...(config.logFile
    ? {
        transport: {
          target: "pino/file",
          options: {
            destination: config.logFile,
            mkdir: true
          }
        }
      }
    : {})
});
