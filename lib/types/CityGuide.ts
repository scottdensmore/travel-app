interface CityGuide {
  id?: number;
  city: string;
  country: string;
  latlong: [number, number];
  description: string;
  highlights: string[];
  coverImage?: string | null;
}

export default CityGuide;
