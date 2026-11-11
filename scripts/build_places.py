"""Builds data/places.json: place names -> ISO 3166-1 alpha-2, used to locate news items.

Country names come from the IANA tz database's country table (via pytz); sub-national regions and
major cities are listed below. Run: uv run --with pytz python scripts/build_places.py
"""

import json
from pathlib import Path

import pytz

EXTRA = {
    "US": [
        "United States", "United States of America", "USA", "U.S.", "American",
        "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut", "Delaware",
        "Florida", "Georgia (U.S. state)", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa", "Kansas",
        "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan", "Minnesota",
        "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire", "New Jersey",
        "New Mexico", "New York (state)", "North Carolina", "North Dakota", "Ohio", "Oklahoma", "Oregon",
        "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota", "Tennessee", "Texas", "Utah",
        "Vermont", "Virginia", "Washington (state)", "West Virginia", "Wisconsin", "Wyoming",
        "New York City", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio",
        "San Diego", "Dallas", "San Francisco", "Seattle", "Boston", "Miami", "Atlanta", "Denver",
        "Las Vegas", "New Orleans", "Washington, D.C.", "Maui", "Asheville",
    ],
    "GB": ["United Kingdom", "UK", "Britain", "Great Britain", "British", "England", "Scotland", "Wales",
           "Northern Ireland", "London", "Manchester", "Birmingham", "Liverpool", "Leeds", "Glasgow",
           "Edinburgh", "Cardiff", "Belfast", "Bristol", "Southport"],
    "FR": ["France", "French", "Paris", "Marseille", "Lyon", "Toulouse", "Nice", "Nantes", "Strasbourg",
           "Bordeaux", "Lille", "Montpellier", "Rennes", "Corsica", "Mayotte"],
    "DE": ["Germany", "German", "Berlin", "Hamburg", "Munich", "Cologne", "Frankfurt", "Stuttgart",
           "Düsseldorf", "Dresden", "Leipzig", "Magdeburg", "Solingen", "Mannheim"],
    "ES": ["Spain", "Spanish", "Madrid", "Barcelona", "Valencia", "Seville", "Bilbao", "Málaga",
           "Valencian Community", "Catalonia", "Andalusia"],
    "IT": ["Italy", "Italian", "Rome", "Milan", "Naples", "Turin", "Florence", "Venice", "Sicily"],
    "CA": ["Canada", "Canadian", "Ontario", "Quebec", "British Columbia", "Alberta", "Manitoba",
           "Saskatchewan", "Nova Scotia", "Toronto", "Montreal", "Vancouver", "Calgary", "Ottawa",
           "Edmonton", "Jasper"],
    "AU": ["Australia", "Australian", "New South Wales", "Victoria (state)", "Queensland",
           "Western Australia", "South Australia", "Tasmania", "Sydney", "Melbourne", "Brisbane", "Perth",
           "Adelaide", "Bondi"],
    "NZ": ["New Zealand", "Christchurch", "Auckland", "Wellington"],
    "BE": ["Belgium", "Belgian", "Brussels", "Antwerp"],
    "NL": ["Netherlands", "Dutch", "Amsterdam", "Rotterdam", "The Hague"],
    "IE": ["Ireland", "Irish", "Dublin"],
    "PT": ["Portugal", "Lisbon", "Porto"],
    "CH": ["Switzerland", "Swiss", "Zurich", "Geneva", "Crans-Montana"],
    "AT": ["Austria", "Vienna", "Graz", "Villach"],
    "SE": ["Sweden", "Stockholm", "Örebro"],
    "NO": ["Norway", "Oslo", "Utøya"],
    "DK": ["Denmark", "Copenhagen"],
    "JP": ["Japan", "Japanese", "Tokyo", "Osaka", "Noto Peninsula"],
    "IN": ["India", "Indian", "Mumbai", "Delhi", "New Delhi", "Bangalore", "Kolkata", "Chennai",
           "Ahmedabad", "Andhra Pradesh", "Tirupati"],
    "BR": ["Brazil", "Brazilian", "São Paulo", "Rio de Janeiro", "Rio Grande do Sul"],
    "MX": ["Mexico", "Mexican", "Mexico City", "Guadalajara"],
    "TR": ["Turkey", "Türkiye", "Turkish", "Istanbul", "Ankara", "Kahramanmaraş"],
    "UA": ["Ukraine", "Ukrainian", "Kyiv", "Kharkiv", "Odesa", "Zaporizhzhia", "Dnipro"],
    "RU": ["Russia", "Russian"],
    "IL": ["Israel", "Israeli", "Tel Aviv", "Jerusalem"],
    "PS": ["Gaza Strip", "Gaza", "West Bank"],
    "MM": ["Myanmar", "Mandalay", "Rakhine State"],
    "TH": ["Thailand", "Thai", "Bangkok"],
    "PH": ["Philippines", "Manila"],
    "ID": ["Indonesia", "Jakarta", "Bali"],
    "CN": ["China", "Chinese", "Beijing", "Shanghai", "Tibet"],
    "ZA": ["South Africa", "Johannesburg", "Cape Town"],
    "JM": ["Jamaica", "Kingston"],
    "CD": ["Democratic Republic of the Congo", "DR Congo", "Goma", "North Kivu"],
    "KE": ["Kenya", "Nairobi"],
    "KH": ["Cambodia", "Kandal province"],
    "BG": ["Bulgaria", "Trakia motorway"],
}


def main() -> None:
    names: dict[str, str] = {}
    for code, name in pytz.country_names.items():
        names[name] = code.upper()
    for code, extras in EXTRA.items():
        for name in extras:
            names[name] = code
    out = Path(__file__).resolve().parent.parent / "data" / "places.json"
    payload = {"source": f"IANA tz country table (pytz {pytz.__version__}) plus regions and cities in scripts/build_places.py", "places": dict(sorted(names.items()))}
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"{out.name}: {len(names)} names")


if __name__ == "__main__":
    main()
