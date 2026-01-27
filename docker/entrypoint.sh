#!/bin/sh
set -e

echo "Waiting for PostgreSQL..."

until nc -z db 5432; do
  sleep 1
done

echo "PostgreSQL is up"

echo "Generate Prisma Client..."
npx prisma generate

echo "Prisma migrate deploy..."
npx prisma migrate deploy

echo "Start app..."
exec "$@"