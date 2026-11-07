import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp(app: INestApplication) {
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    allowedHeaders: ['Content-Type', 'Authorization'],
  });
  app.enableShutdownHooks();
}
