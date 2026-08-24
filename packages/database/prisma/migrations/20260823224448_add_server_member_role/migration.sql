-- CreateEnum
CREATE TYPE "role" AS ENUM ('NOVATO', 'PLAYER', 'SQUADMATE', 'VETERAN', 'MVP', 'ELITE', 'MOD', 'ADMIN');

-- AlterTable
ALTER TABLE "server_members" ADD COLUMN     "role" "role" NOT NULL DEFAULT 'NOVATO';
