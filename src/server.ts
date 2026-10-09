import { buildApp } from './app';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

buildApp()
  .listen({ port, host })
  .then((address) => console.log(`API ouvindo em ${address} (POST /classify)`))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
