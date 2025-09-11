import { createServer } from './server.js';
import { env } from './lib/env.js';
const app = createServer();
const server = app.listen(env.PORT, () => {
    console.log(`Server http://localhost:${env.PORT}`);
});
try {
    // @ts-ignore
    server.requestTimeout = 0;
    // @ts-ignore
    server.keepAliveTimeout = 120000;
    // @ts-ignore
    if (typeof server.setTimeout === 'function')
        server.setTimeout(0);
}
catch { }
//# sourceMappingURL=index.js.map