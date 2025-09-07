import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import {
  FastifyAdapter,
  NestFastifyApplication,
} from "@nestjs/platform-fastify";
import helmet from "@fastify/helmet";
import cors from "@fastify/cors";
import { validateEnv } from "@config/env.validation";
import { Logger } from "nestjs-pino";
import { RequestIdMiddleware } from "@common/middleware/request-id.middleware";
// Optional Swagger (only if DOCS_ENABLED=true)
import { setupSwagger } from "./app.swagger";


async function bootstrap() {
  validateEnv();

  const adapter = new FastifyAdapter({ trustProxy: true });
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    adapter,
    {
      bufferLogs: true,
    }
  );

  // Logger (pino)
  app.useLogger(app.get(Logger));

  // Security & CORS
  await app.register(helmet);
  await app.register(cors, {
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Request-Id",
      "X-Admin-Token",
    ],
    exposedHeaders: ["X-Request-Id"],
  });

  // Request ID
  // app.use(new RequestIdMiddleware().use as any);

  // Swagger (optional)
  if (process.env.DOCS_ENABLED === "true") {
    setupSwagger(app);
  }

  const port = Number(process.env.APP_PORT || 4000);
  await app.listen(port, "0.0.0.0");
  console.log(`API listening on :${port}`);
}
bootstrap();
