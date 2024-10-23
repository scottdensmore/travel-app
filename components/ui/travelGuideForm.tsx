import React, { useState } from 'react';
import TravelGuideService from '../../lib/TravelGuideService';
import CityGuide from '../../lib/types/CityGuide';

const TravelGuideForm: React.FC = () => {
  const [city, setCity] = useState('');
  const [country, setCountry] = useState('');
  const [description, setDescription] = useState('');
  const [highlights, setHighlights] = useState<string[]>(['']);
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [error, setError] = useState<string>('');
  const [saveresult, setSaveResult] = useState<string>('');
  const [showAddButtons, setShowAddButtons] = useState<boolean[]>([true]);

  const travelGuideService = new TravelGuideService();

  const handleHighlightChange = (index: number, value: string) => {
    const newHighlights = [...highlights];
    newHighlights[index] = value;
    setHighlights(newHighlights);
  };

  const addHighlight = (index: number) => {
    setHighlights([...highlights, '']);
    const newShowAddButtons = [...showAddButtons];
    newShowAddButtons[index] = false; // Hide the button that was clicked
    newShowAddButtons.push(true); // Add a new button for the new highlight
    setShowAddButtons(newShowAddButtons);
    };

  const fetchCoordinates = async (cityName: string, countryName: string) => {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityName)},${encodeURIComponent(countryName)}&format=json`
      );
      const data = await response.json();
      if (data && data.length > 0) {
        setLatitude(parseFloat(data[0].lat));
        setLongitude(parseFloat(data[0].lon));
        setError('');
        console.log({ latitude, longitude });
      } else {
        setLatitude(null);
        setLongitude(null);
        setError('Location not found.');
        console.log('Location not found.');
      }
    } catch {
      setLatitude(null);
      setLongitude(null);
      setError('Failed to fetch coordinates.');
      console.log('Failed to fetch coordinates.');
    }
  };

  const handleBlur = () => {
    if (city && country) {
      fetchCoordinates(city, country);
    } else {
      setLatitude(null);
      setLongitude(null);
      setError('');
    }
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    console.log({ city, country, description, highlights, latitude, longitude });
    const cityGuide: CityGuide = {
      id: 1,
      city: city,
      country: country,
      latlong: [latitude || 0, longitude || 0],
      description: description,
      highlights: highlights
    };
    travelGuideService.saveCityGuide(cityGuide)
      .then(() => setSaveResult('City guide saved successfully'))
      .catch(() => setSaveResult('Failed to save city guide'));
  };


  return (
    <div className="admin-card">   
      <h2>Add a New Travel Guide</h2>
      <form onSubmit={handleSubmit} id="travelGuideForm">
        <div>
          <label htmlFor='city'> City: </label>
            <input
              id="city"
              placeholder="Enter city name"
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              onBlur={handleBlur}
            />
          
        </div>
        <div>
          <label htmlFor='country'> Country: </label>
            <input
              id="country"
              placeholder="Enter country name"
              type="text"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              onBlur={handleBlur}
            />
          
        </div>
        <div>
        {latitude && <div><i><strong>Location:</strong> {latitude},{longitude}</i></div>}
        {error && <div className="text-red-500 mb-4">{error}</div>}
        </div>
        <div>
          <label htmlFor='description'> Description: </label>
            <textarea
              id="description"
              placeholder="Enter Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          
        </div>
        <div>
          <label>Highlights:</label>
          {highlights.map((highlight, index) => (
            <div key={index} className="highlight-container">
              <input
                placeholder="Add Highlight"
                type="text"
                value={highlight}
                onChange={(e) => handleHighlightChange(index, e.target.value)}
              />
              {showAddButtons[index] && (
                <button
                  type="button"
                  onClick={() => addHighlight(index)}
                  className="highlight-button"
                >
                  +
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="submit">
          Submit
        </button>
        {saveresult && <div className="text-green-500 mb-4">{saveresult}</div>}
      </form>
    </div>
  );
};

export default TravelGuideForm;