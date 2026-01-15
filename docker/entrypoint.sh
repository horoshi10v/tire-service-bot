#!/bin/sh
set -e

echo "Generate Prisma Client..."
npx prisma generate

echo "Prisma migrate deploy..."
npx prisma migrate deploy

echo "Start app..."
exec "$@"