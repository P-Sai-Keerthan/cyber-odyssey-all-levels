-- CreateTable
CREATE TABLE "Level3Config" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "targetIp" TEXT,
    "track1Points" INTEGER NOT NULL DEFAULT 3500,
    "track2Points" INTEGER NOT NULL DEFAULT 6500,
    "track2Released" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "Level3Config_pkey" PRIMARY KEY ("id")
);
