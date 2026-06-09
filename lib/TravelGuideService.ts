import { prisma } from "@/lib/prisma";
import CityGuide from "./types/CityGuide";

class TravelGuideService {

  async getCityGuideData(): Promise<CityGuide[]> {
    const data = await prisma.cityGuide.findMany();
    // Map Prisma result back to our CityGuide type if needed (e.g. latlong handling)
    // In our schema we stored latlong as Float[], which matches [number, number] mostly.
    return data.map(item => ({
      ...item,
      latlong: item.latlong as [number, number]
    }));
  }

  async saveCityGuide(cityGuide: CityGuide): Promise<CityGuide> {
    const saved = await prisma.cityGuide.create({
      data: {
        city: cityGuide.city,
        country: cityGuide.country,
        latlong: cityGuide.latlong,
        description: cityGuide.description,
        highlights: cityGuide.highlights,
        coverImage: cityGuide.coverImage,
      }
    });

    return {
      ...saved,
      latlong: saved.latlong as [number, number]
    };
  }
}

export default TravelGuideService;