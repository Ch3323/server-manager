-- CreateEnum
CREATE TYPE "WorkspaceAccess" AS ENUM ('VIEW', 'EDIT');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "workspacePath" TEXT NOT NULL DEFAULT '',
ADD COLUMN "workspaceAccess" "WorkspaceAccess" NOT NULL DEFAULT 'VIEW';
