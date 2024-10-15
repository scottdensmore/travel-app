import CityGuideData from "./data/CityGuideData";
import CityGuide from "./types/CityGuide";

class TravelGuideService {

  getCityGuideData(): CityGuide[] {
    return CityGuideData;
  }

  saveCityGuide(cityGuide: CityGuide): CityGuide {
    console.log("City guide saved to database");
    return cityGuide;
  }
}

export default TravelGuideService;