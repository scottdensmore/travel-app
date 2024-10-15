import CityGuideData from "./data/CityGuideData";
import CityGuide from "./types/CityGuide";

class TravelGuideService {

  getCityGuideData(): CityGuide[] {
    return CityGuideData;
  }

  async saveCityGuide(cityGuide: CityGuide): Promise<CityGuide> {
    await new Promise(resolve => setTimeout(resolve, 1000));
    console.log("City guide saved to database");
    return cityGuide;
  }
}

export default TravelGuideService;