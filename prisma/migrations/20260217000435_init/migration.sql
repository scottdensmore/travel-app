-- CreateTable
CREATE TABLE "CityGuide" (
    "id" SERIAL NOT NULL,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "latlong" DOUBLE PRECISION[],
    "description" TEXT NOT NULL,
    "highlights" TEXT[],
    "coverImage" TEXT,

    CONSTRAINT "CityGuide_pkey" PRIMARY KEY ("id")
);
