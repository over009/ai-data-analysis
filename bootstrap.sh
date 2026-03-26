#!/bin/bash
# FC 3.0 Custom Runtime bootstrap
# FC sets PORT=9000 by default
export PORT=${FC_SERVER_PORT:-9000}
cd /code
exec npx tsx server/index.ts
